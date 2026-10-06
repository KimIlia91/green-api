import { create } from 'zustand'

import {
  recordChatActivity,
  refreshPreviewText,
  reliableContactName,
  useChatStore,
} from '@/entities/chat'
import {
  applyHistoryEvents,
  mapHistoryEntry,
  mergeChatHistory,
  messageEditFromEntry,
  messagePreview,
  publishMessageEdit,
  rememberMessageOrigin,
  selfAuthorName,
  useMessageStore,
  type MessageEdit,
} from '@/entities/message'
import { sessionIdentity, useSessionStore } from '@/entities/session'
import {
  classifyTariffLimit,
  createGreenApiClient,
  GreenApiError,
} from '@/shared/api'
import type { GreenApiClient, TariffLimitKind } from '@/shared/api'
import { showToast } from '@/shared/lib/toast'

export const chatHistoryCount = 100

export const chatHistoryErrorMessage = 'История не загружена'

export const chatHistoryRefreshErrorMessage = 'Не удалось обновить историю'

export const chatHistoryFailureMessage = 'Не удалось загрузить историю чата'

const historyChatQuotaMessage = 'Превышена квота чатов тарифа.'

const historyMethodQuotaMessage = 'Превышена квота метода загрузки истории.'

const historyBothQuotaMessage =
  'Превышена квота чатов и метода загрузки истории.'

const historyTariffLimitMessage = 'Сработало ограничение тарифа.'

type HistoryPhase = 'loading' | 'ready' | 'error'

type LoadHistoryState = {
  phaseByChatId: Record<string, HistoryPhase>
  errorByChatId: Record<string, string>
  mark: (chatId: string, phase: HistoryPhase, errorText?: string) => void
  reset: () => void
}

export const useLoadHistoryStore = create<LoadHistoryState>()((set) => ({
  phaseByChatId: {},
  errorByChatId: {},
  mark: (chatId, phase, errorText) => {
    set((state) => ({
      phaseByChatId: {
        ...state.phaseByChatId,
        [chatId]: phase,
      },
      errorByChatId:
        phase === 'error' && errorText !== undefined
          ? { ...state.errorByChatId, [chatId]: errorText }
          : omitKey(state.errorByChatId, chatId),
    }))
  },
  reset: () => {
    set({ phaseByChatId: {}, errorByChatId: {} })
  },
}))

export const selectHistoryPhase =
  (chatId: string) =>
  (state: LoadHistoryState): HistoryPhase | null =>
    state.phaseByChatId[chatId] ?? null

export const selectHistoryError =
  (chatId: string) =>
  (state: LoadHistoryState): string | null =>
    state.errorByChatId[chatId] ?? null

type LoadHistoryOptions = {
  refresh?: boolean
  client?: Pick<GreenApiClient, 'getChatHistory'>
  createId?: () => string
}

let generation = 0
let attemptSerial = 0
const inflight = new Map<string, Promise<void>>()
const loaded = new Set<string>()
const controllers = new Map<string, AbortController>()

export function cancelChatHistoryLoads(): void {
  generation += 1
  for (const abort of controllers.values()) {
    abort.abort()
  }
  controllers.clear()
  inflight.clear()
  loaded.clear()
  useLoadHistoryStore.getState().reset()
}

export function loadChatHistory(
  chatId: string,
  options: LoadHistoryOptions = {},
): Promise<void> {
  if (options.refresh !== true && loaded.has(chatId)) {
    return Promise.resolve()
  }

  const current = inflight.get(chatId)
  if (current) {
    return current
  }

  const connection = useSessionStore.getState().connection
  if (connection === null) {
    return Promise.resolve()
  }

  const generationAtStart = generation
  const sessionKey = sessionIdentity(connection)
  const updating = loaded.has(chatId)
  const attemptKey = `history:${chatId}:${String((attemptSerial += 1))}`
  const abort = new AbortController()
  controllers.set(chatId, abort)
  useLoadHistoryStore.getState().mark(chatId, 'loading')
  const task = run(
    chatId,
    options,
    connection,
    abort,
    generationAtStart,
    sessionKey,
    updating,
    attemptKey,
  ).finally(() => {
    if (controllers.get(chatId) === abort) {
      controllers.delete(chatId)
    }
    inflight.delete(chatId)
  })
  inflight.set(chatId, task)
  return task
}

async function run(
  chatId: string,
  options: LoadHistoryOptions,
  connection: NonNullable<
    ReturnType<typeof useSessionStore.getState>['connection']
  >,
  abort: AbortController,
  generationAtStart: number,
  sessionKey: string,
  updating: boolean,
  attemptKey: string,
): Promise<void> {
  try {
    const api = options.client ?? createGreenApiClient(connection)
    const entries = await api.getChatHistory(
      { chatId, count: chatHistoryCount },
      { signal: abort.signal },
    )
    if (!isCurrent(generationAtStart, sessionKey, abort.signal)) {
      return
    }

    const createId = options.createId ?? (() => crypto.randomUUID())
    applyHistoryEvents(
      entries,
      (id) => {
        return useChatStore.getState().chatsById[id]?.lastActivityAt ?? null
      },
      useChatStore.getState(),
    )
    const drafts = []
    const edits: MessageEdit[] = []
    for (const entry of entries) {
      const edit = messageEditFromEntry(entry)
      if (edit !== null) {
        edits.push(edit)
        continue
      }
      const draft = mapHistoryEntry(entry)
      if (draft !== null) {
        drafts.push(draft)
      }
    }
    edits.sort((left, right) => (left.eventAt ?? 0) - (right.eventAt ?? 0))
    mergeChatHistory(chatId, drafts, createId)
    rememberLoadedOrigins(chatId)
    for (const edit of edits) {
      const chat = useChatStore.getState()
      publishMessageEdit(
        edit,
        chat.chatsById[chatId]?.lastActivityAt ?? null,
        chat,
      )
    }
    if (!isCurrent(generationAtStart, sessionKey, abort.signal)) {
      return
    }

    syncPreview(chatId)
    loaded.add(chatId)
    useLoadHistoryStore.getState().mark(chatId, 'ready')
  } catch (error) {
    if (
      !isCurrent(generationAtStart, sessionKey, abort.signal) ||
      (error instanceof GreenApiError && error.kind === 'abort')
    ) {
      return
    }

    const shortMessage = updating
      ? chatHistoryRefreshErrorMessage
      : chatHistoryErrorMessage
    if (useChatStore.getState().activeChatId === chatId) {
      showToast({
        kind: 'error',
        message: failureNotice(error),
        dedupeKey: attemptKey,
      })
    }
    useLoadHistoryStore.getState().mark(chatId, 'error', shortMessage)
  }
}

function failureNotice(error: unknown): string {
  if (
    error instanceof GreenApiError &&
    error.kind === 'http' &&
    error.status === 466
  ) {
    return tariffNotice(classifyTariffLimit(error.responseBody))
  }

  return chatHistoryFailureMessage
}

function tariffNotice(kind: TariffLimitKind): string {
  if (kind === 'chats') {
    return historyChatQuotaMessage
  }
  if (kind === 'method') {
    return historyMethodQuotaMessage
  }
  if (kind === 'both') {
    return historyBothQuotaMessage
  }
  return historyTariffLimitMessage
}

function rememberLoadedOrigins(chatId: string): void {
  const chat = useChatStore.getState().chatsById[chatId]
  const contact = chat === undefined ? null : reliableContactName(chat)
  const state = useMessageStore.getState()
  const ids = state.messageIdsByChatId[chatId] ?? []
  for (const localId of ids) {
    const message = state.messagesById[localId]
    if (message === undefined) {
      continue
    }
    rememberMessageOrigin(
      localId,
      message.direction === 'outgoing' ? selfAuthorName : (contact ?? ''),
    )
  }
}

function syncPreview(chatId: string): void {
  const state = useMessageStore.getState()
  const ids = state.messageIdsByChatId[chatId] ?? []
  let latestAt = -1
  let preview: string | null = null
  let forwarded = false
  for (const localId of ids) {
    const message = state.messagesById[localId]
    if (message === undefined || message.createdAt < latestAt) {
      continue
    }
    latestAt = message.createdAt
    preview = messagePreview(message)
    forwarded = message.forwarded === true
  }

  if (preview === null) {
    return
  }

  const lastActivityAt =
    useChatStore.getState().chatsById[chatId]?.lastActivityAt ?? null
  if (lastActivityAt === null || latestAt > lastActivityAt) {
    recordChatActivity(chatId, {
      preview,
      at: latestAt,
      forwarded,
    })
    return
  }
  if (latestAt === lastActivityAt) {
    refreshPreviewText(chatId, preview, latestAt)
    recordChatActivity(chatId, {
      preview,
      at: latestAt,
      forwarded,
    })
  }
}

function isCurrent(
  generationAtStart: number,
  sessionKey: string,
  signal: AbortSignal,
): boolean {
  return (
    generationAtStart === generation &&
    !signal.aborted &&
    sessionIdentity(useSessionStore.getState().connection) === sessionKey
  )
}

function omitKey(
  record: Record<string, string>,
  key: string,
): Record<string, string> {
  if (!(key in record)) {
    return record
  }

  const next = { ...record }
  delete next[key]
  return next
}
