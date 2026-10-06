import { create } from 'zustand'

import {
  recordChatActivity,
  refreshPreviewText,
  useChatStore,
} from '@/entities/chat'
import {
  applyHistoryEvents,
  latestDisplayedActivity,
  mapHistoryEntry,
  mergeChatHistory,
  messageEditFromEntry,
  messagePreview,
  publishMessageEdit,
  type MessageEdit,
} from '@/entities/message'
import { sessionIdentity, useSessionStore } from '@/entities/session'
import { createGreenApiClient, GreenApiError } from '@/shared/api'
import type { ChatHistoryEntry, GreenApiClient } from '@/shared/api'

export const chatPreviewCount = 1

export const chatPreviewBackfillCount = 20

export const chatPreviewErrorMessage = 'Не удалось загрузить превью.'

type PreviewState = {
  failedIds: string[]
  fail: (chatId: string) => void
  clearFailed: (chatId: string) => void
  reset: () => void
}

export const useChatPreviewStore = create<PreviewState>()((set) => ({
  failedIds: [],
  fail: (chatId) => {
    set((state) => {
      if (state.failedIds.includes(chatId)) {
        return state
      }

      return { failedIds: [...state.failedIds, chatId] }
    })
  },
  clearFailed: (chatId) => {
    set((state) => {
      if (!state.failedIds.includes(chatId)) {
        return state
      }

      return { failedIds: state.failedIds.filter((id) => id !== chatId) }
    })
  },
  reset: () => {
    set({ failedIds: [] })
  },
}))

export const selectChatPreviewFailed = (state: PreviewState): boolean =>
  state.failedIds.length > 0

type PreviewClient = Pick<GreenApiClient, 'getChatHistory'>

type PreviewOptions = {
  client?: PreviewClient
  createId?: () => string
}

let generation = 0
let pending: string[] = []
let inflight: string | null = null
let controller: AbortController | null = null
let client: PreviewClient | undefined
let createId: (() => string) | undefined
const settled = new Set<string>()
const skipped = new Set<string>()
const held = new Set<string>()
const failed = new Set<string>()

export function cancelChatPreviewLoads(): void {
  generation += 1
  pending = []
  inflight = null
  settled.clear()
  skipped.clear()
  held.clear()
  failed.clear()
  controller?.abort()
  controller = null
  useChatPreviewStore.getState().reset()
}

export function loadChatPreviews(
  priorityIds: readonly string[],
  options: PreviewOptions = {},
): void {
  if (options.client !== undefined) {
    client = options.client
  }
  if (options.createId !== undefined) {
    createId = options.createId
  }

  const known = useChatStore.getState().chatIds
  const priority = new Set(priorityIds)
  const ordered = [
    ...priorityIds.filter((chatId) => known.includes(chatId)),
    ...known.filter((chatId) => !priority.has(chatId)),
  ]
  const next: string[] = []
  for (const chatId of ordered) {
    if (blocked(chatId) || inflight === chatId || failed.has(chatId)) {
      continue
    }
    if (!next.includes(chatId)) {
      next.push(chatId)
    }
  }
  pending = next
  pump()
}

export function retryFailedChatPreviews(): void {
  const ids = [...failed]
  failed.clear()
  useChatPreviewStore.getState().reset()
  pending = [
    ...ids.filter((chatId) => !blocked(chatId) && inflight !== chatId),
    ...pending.filter((chatId) => !ids.includes(chatId)),
  ]
  pump()
}

export function holdChatPreview(chatId: string): void {
  held.add(chatId)
  pending = pending.filter((id) => id !== chatId)
  if (inflight === chatId) {
    controller?.abort()
  }
}

export function skipChatPreview(chatId: string): void {
  skipped.add(chatId)
  held.delete(chatId)
  failed.delete(chatId)
  settled.add(chatId)
  pending = pending.filter((id) => id !== chatId)
  useChatPreviewStore.getState().clearFailed(chatId)
}

export function releaseChatPreview(chatId: string): void {
  held.delete(chatId)
  if (blocked(chatId) || inflight === chatId || pending.includes(chatId)) {
    return
  }

  pending = [chatId, ...pending]
  pump()
}

function blocked(chatId: string): boolean {
  return settled.has(chatId) || skipped.has(chatId) || held.has(chatId)
}

function pump(): void {
  if (inflight !== null) {
    return
  }
  if (useSessionStore.getState().connection === null) {
    return
  }

  while (
    pending.length > 0 &&
    pending[0] !== undefined &&
    blocked(pending[0])
  ) {
    pending.shift()
  }

  const chatId = pending[0]
  if (chatId === undefined) {
    return
  }

  pending.shift()
  const connection = useSessionStore.getState().connection
  if (connection === null) {
    return
  }

  const generationAtStart = generation
  const sessionKey = sessionIdentity(connection)
  const abort = new AbortController()
  controller = abort
  inflight = chatId
  const task = run(chatId, connection, abort, generationAtStart, sessionKey)
  void task.finally(() => {
    if (generationAtStart !== generation) {
      return
    }
    if (inflight === chatId) {
      inflight = null
    }
    if (controller === abort) {
      controller = null
    }
    pump()
  })
}

async function run(
  chatId: string,
  connection: NonNullable<
    ReturnType<typeof useSessionStore.getState>['connection']
  >,
  abort: AbortController,
  generationAtStart: number,
  sessionKey: string,
): Promise<void> {
  try {
    const api = client ?? createGreenApiClient(connection)
    let entries = await api.getChatHistory(
      { chatId, count: chatPreviewCount },
      { signal: abort.signal },
    )
    if (!isCurrent(generationAtStart, sessionKey, abort.signal)) {
      return
    }

    if (useChatStore.getState().chatsById[chatId] === undefined) {
      settled.add(chatId)
      failed.delete(chatId)
      useChatPreviewStore.getState().clearFailed(chatId)
      return
    }

    rememberJournal(entries, chatId)
    if (
      needsPreviewBackfill(entries, chatId) &&
      isCurrent(generationAtStart, sessionKey, abort.signal)
    ) {
      entries = await api.getChatHistory(
        { chatId, count: chatPreviewBackfillCount },
        { signal: abort.signal },
      )
      if (!isCurrent(generationAtStart, sessionKey, abort.signal)) {
        return
      }
      rememberJournal(entries, chatId)
    }

    settled.add(chatId)
    failed.delete(chatId)
    useChatPreviewStore.getState().clearFailed(chatId)

    const scoped = entries.filter((entry) => entry.chatId === chatId)
    const edits = scoped
      .map((entry) => messageEditFromEntry(entry))
      .filter((edit): edit is MessageEdit => edit !== null)
      .sort((left, right) => (left.eventAt ?? 0) - (right.eventAt ?? 0))
    const latest = latestEntry(scoped)
    if (latest !== null) {
      const draft = mapHistoryEntry(latest)
      if (draft !== null) {
        mergeChatHistory(
          chatId,
          [draft],
          createId ?? (() => crypto.randomUUID()),
        )
        if (!isCurrent(generationAtStart, sessionKey, abort.signal)) {
          return
        }

        const preview = messagePreview(draft)
        if (preview !== '') {
          const lastActivityAt =
            useChatStore.getState().chatsById[chatId]?.lastActivityAt ?? null
          const forwarded = draft.forwarded === true
          if (lastActivityAt === null || draft.createdAt > lastActivityAt) {
            recordChatActivity(chatId, {
              preview,
              at: draft.createdAt,
              forwarded,
            })
          } else if (draft.createdAt === lastActivityAt) {
            refreshPreviewText(chatId, preview, draft.createdAt)
            recordChatActivity(chatId, {
              preview,
              at: draft.createdAt,
              forwarded,
            })
          }
        }
      }
    }
    if (!isCurrent(generationAtStart, sessionKey, abort.signal)) {
      return
    }

    for (const edit of edits) {
      const chat = useChatStore.getState()
      publishMessageEdit(
        edit,
        chat.chatsById[chatId]?.lastActivityAt ?? null,
        chat,
      )
    }
  } catch (error) {
    if (
      !isCurrent(generationAtStart, sessionKey, abort.signal) ||
      (error instanceof GreenApiError && error.kind === 'abort')
    ) {
      return
    }

    failed.add(chatId)
    useChatPreviewStore.getState().fail(chatId)
  }
}

function rememberJournal(entries: ChatHistoryEntry[], chatId: string): void {
  applyHistoryEvents(
    entries.filter((entry) => entry.chatId === chatId),
    (id) => useChatStore.getState().chatsById[id]?.lastActivityAt ?? null,
    useChatStore.getState(),
  )
}

function needsPreviewBackfill(
  entries: ChatHistoryEntry[],
  chatId: string,
): boolean {
  const scoped = entries.filter((entry) => entry.chatId === chatId)
  if (
    scoped.length === 0 ||
    scoped.some((entry) => mapHistoryEntry(entry) !== null)
  ) {
    return false
  }
  if (!scoped.some(isJournalEntry)) {
    return false
  }
  return latestDisplayedActivity(chatId) === null
}

function isJournalEntry(entry: ChatHistoryEntry): boolean {
  return (
    entry.editEvent !== null ||
    entry.reaction != null ||
    entry.deletion != null ||
    entry.deleted === true
  )
}

function latestEntry(entries: ChatHistoryEntry[]): ChatHistoryEntry | null {
  let latest: ChatHistoryEntry | null = null
  for (const entry of entries) {
    if (isJournalEntry(entry)) {
      continue
    }
    if (latest === null || entry.timestamp > latest.timestamp) {
      latest = entry
    }
  }
  return latest
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
