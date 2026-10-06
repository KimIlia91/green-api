import { create } from 'zustand'

import { mergeRemoteChats, type RemoteChatInput } from '@/entities/chat'
import { sessionIdentity, useSessionStore } from '@/entities/session'
import {
  classifyTariffLimit,
  createGreenApiClient,
  GreenApiError,
} from '@/shared/api'
import type {
  ChatDirectoryEntry,
  GreenApiClient,
  TariffLimitKind,
} from '@/shared/api'
import { showToast } from '@/shared/lib/toast'

export const chatListErrorMessage = 'Список чатов не загружен'

export const chatListFailureMessage = 'Не удалось загрузить список чатов'

const chatListChatQuotaMessage = 'Превышена квота чатов тарифа.'

const chatListMethodQuotaMessage = 'Превышена квота метода загрузки.'

const chatListBothQuotaMessage = 'Превышена квота чатов и метода загрузки.'

const chatListTariffLimitMessage = 'Сработало ограничение тарифа.'

type LoadChatsStatus = 'idle' | 'loading' | 'ready' | 'error'

type LoadChatsState = {
  status: LoadChatsStatus
  errorText: string | null
  begin: () => void
  succeed: () => void
  fail: (errorText: string) => void
  reset: () => void
}

export const useLoadChatsStore = create<LoadChatsState>()((set) => ({
  status: 'idle',
  errorText: null,
  begin: () => {
    set({ status: 'loading', errorText: null })
  },
  succeed: () => {
    set({ status: 'ready', errorText: null })
  },
  fail: (errorText) => {
    set({ status: 'error', errorText })
  },
  reset: () => {
    set({ status: 'idle', errorText: null })
  },
}))

export const selectChatListStatus = (state: LoadChatsState) => state.status

export const selectChatListError = (state: LoadChatsState) => state.errorText

type LoadChatsOptions = {
  client?: Pick<GreenApiClient, 'getChats'>
}

let generation = 0
let attemptSerial = 0
let inflight: Promise<void> | null = null
let controller: AbortController | null = null

export function cancelChatListLoad(): void {
  generation += 1
  controller?.abort()
  controller = null
  inflight = null
  useLoadChatsStore.getState().reset()
}

export function loadChatList(options: LoadChatsOptions = {}): Promise<void> {
  if (inflight) {
    return inflight
  }

  const connection = useSessionStore.getState().connection
  if (connection === null) {
    return Promise.resolve()
  }

  const generationAtStart = generation
  const sessionKey = sessionIdentity(connection)
  const attemptKey = `chats:${String((attemptSerial += 1))}`
  const abort = new AbortController()
  controller = abort
  useLoadChatsStore.getState().begin()
  const task = run(
    options,
    connection,
    abort,
    generationAtStart,
    sessionKey,
    attemptKey,
  ).finally(() => {
    if (controller === abort) {
      controller = null
    }
    inflight = null
  })
  inflight = task
  return task
}

async function run(
  options: LoadChatsOptions,
  connection: NonNullable<
    ReturnType<typeof useSessionStore.getState>['connection']
  >,
  abort: AbortController,
  generationAtStart: number,
  sessionKey: string,
  attemptKey: string,
): Promise<void> {
  try {
    const api = options.client ?? createGreenApiClient(connection)
    const entries = await api.getChats({ signal: abort.signal })
    if (!isCurrent(generationAtStart, sessionKey, abort.signal)) {
      return
    }

    mergeRemoteChats(personalChats(entries))
    if (!isCurrent(generationAtStart, sessionKey, abort.signal)) {
      return
    }

    useLoadChatsStore.getState().succeed()
  } catch (error) {
    if (
      !isCurrent(generationAtStart, sessionKey, abort.signal) ||
      (error instanceof GreenApiError && error.kind === 'abort')
    ) {
      return
    }

    showToast({
      kind: 'error',
      message: failureNotice(error),
      dedupeKey: attemptKey,
    })
    useLoadChatsStore.getState().fail(chatListErrorMessage)
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

  return chatListFailureMessage
}

function tariffNotice(kind: TariffLimitKind): string {
  if (kind === 'chats') {
    return chatListChatQuotaMessage
  }
  if (kind === 'method') {
    return chatListMethodQuotaMessage
  }
  if (kind === 'both') {
    return chatListBothQuotaMessage
  }
  return chatListTariffLimitMessage
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

function personalChats(entries: ChatDirectoryEntry[]): RemoteChatInput[] {
  const chats: RemoteChatInput[] = []
  for (const entry of entries) {
    if (entry.type !== 'user') {
      continue
    }

    chats.push({
      chatId: entry.chatId,
      name: entry.name.trim() === '' ? null : entry.name.trim(),
      phoneNumber:
        entry.phoneNumber > 0 && Number.isSafeInteger(entry.phoneNumber)
          ? String(entry.phoneNumber)
          : null,
    })
  }
  return chats
}
