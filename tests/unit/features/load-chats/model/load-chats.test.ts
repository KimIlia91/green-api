import { beforeEach, describe, expect, it } from 'vitest'

import {
  noteUnseenIncoming,
  recordChatActivity,
  resetChats,
  selectChat,
  upsertChat,
  useChatStore,
} from '@/entities/chat'
import {
  clearSession,
  establishSession,
  useSessionStore,
} from '@/entities/session'
import { GreenApiError } from '@/shared/api'
import type { ChatDirectoryEntry } from '@/shared/api'
import { resetToastStore, useToastStore } from '@/shared/lib/toast'

import {
  cancelChatListLoad,
  chatListErrorMessage,
  chatListFailureMessage,
  loadChatList,
  useLoadChatsStore,
} from '@/features/load-chats/model/load-chats.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('loadChatList', () => {
  beforeEach(() => {
    resetToastStore()
    cancelChatListLoad()
    resetChats()
    clearSession()
    establishSession(connection, 'authorized')
  })

  it('keeps personal chats and does not wipe known data with blanks', async () => {
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: 'Анна',
      username: null,
    })
    selectChat('10000000')
    recordChatActivity('10000000', {
      preview: 'Живое',
      at: 20,
    })
    noteUnseenIncoming('10000000', 'incoming-a')
    noteUnseenIncoming('10000000', 'incoming-b')
    upsertChat({
      chatId: 'local-chat',
      phoneNumber: '375291112233',
      name: 'Во время загрузки',
      username: null,
    })

    await loadChatList({
      client: {
        getChats: () =>
          Promise.resolve([
            entry({
              chatId: '10000000',
              name: ' ',
              phoneNumber: 0,
            }),
            entry({
              chatId: '-100',
              name: 'Группа',
              type: 'group',
              phoneNumber: 0,
            }),
            entry({
              chatId: '10000002',
              name: 'Green-API bot',
              type: 'bot',
              phoneNumber: 0,
            }),
            entry({
              chatId: '10000001',
              name: '',
              phoneNumber: 0,
            }),
          ]),
      },
    })

    const state = useChatStore.getState()
    expect(state.chatIds).toEqual(['10000000', 'local-chat', '10000001'])
    expect(state.activeChatId).toBe('10000000')
    expect(state.chatsById['10000000']).toMatchObject({
      name: 'Анна',
      phoneNumber: '79991234567',
      preview: 'Живое',
      unseenIncomingIds: ['incoming-a', 'incoming-b'],
    })
    expect(state.chatsById['-100']).toBeUndefined()
    expect(state.chatsById['10000002']).toBeUndefined()
    expect(state.chatsById['10000001']).toMatchObject({
      name: null,
      phoneNumber: null,
    })
    expect(useLoadChatsStore.getState().status).toBe('ready')
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('shows an error and loads on retry without dropping a new chat', async () => {
    upsertChat({
      chatId: 'local-chat',
      phoneNumber: '79990000000',
      name: null,
      username: null,
    })
    let calls = 0
    const client = {
      getChats: (): Promise<ChatDirectoryEntry[]> => {
        calls += 1
        if (calls === 1) {
          return Promise.reject(new GreenApiError('network', 'offline'))
        }
        return Promise.resolve([
          entry({ chatId: '10000000', name: 'Анна', phoneNumber: 79991234567 }),
        ])
      },
    }

    await loadChatList({ client })
    expect(useLoadChatsStore.getState()).toMatchObject({
      status: 'error',
      errorText: chatListErrorMessage,
    })
    expect(chatListErrorMessage).toBe('Список чатов не загружен')
    expect(toastTexts()).toEqual([chatListFailureMessage])
    expect(useChatStore.getState().chatIds).toEqual(['local-chat'])
    expect(calls).toBe(1)

    upsertChat({
      chatId: 'created-after-error',
      phoneNumber: '79991111111',
      name: 'Новый',
      username: null,
    })

    await loadChatList({ client })
    expect(useLoadChatsStore.getState()).toMatchObject({
      status: 'ready',
      errorText: null,
    })
    expect(toastTexts()).toEqual([chatListFailureMessage])
    expect(useChatStore.getState().chatIds).toEqual([
      'local-chat',
      'created-after-error',
      '10000000',
    ])
  })

  it('does not present the first failed load as an empty successful list', async () => {
    await loadChatList({
      client: {
        getChats: () => Promise.reject(new GreenApiError('network', 'offline')),
      },
    })

    expect(useChatStore.getState().chatIds).toEqual([])
    expect(useLoadChatsStore.getState()).toMatchObject({
      status: 'error',
      errorText: chatListErrorMessage,
    })
    expect(toastTexts()).toEqual([chatListFailureMessage])
  })

  it('classifies HTTP 466 without calling every body a chat quota', async () => {
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: 'Анна',
      username: null,
    })
    const bodies = [
      {
        invokeStatus: {
          status: 'QUOTE_ALLOWED',
          description: 'https://console.green-api.com token abc123',
        },
        correspondentsStatus: { status: 'CORRESPONDENTS_QUOTA_EXCEEDED' },
      },
      {
        invokeStatus: { status: 'QUOTE_EXCEEDED' },
        quotaData: { status: 'QUOTE_ALLOWED' },
      },
      {
        invokeStatus: { status: 'QUOTA_EXCEEDED' },
        correspondentsStatus: { status: 'CORRESPONDENTS_QUOTA_EXCEEDED' },
      },
      { invokeStatus: { status: 'QUOTE_ALLOWED' } },
      null,
    ]
    const notices = [
      'Превышена квота чатов тарифа.',
      'Превышена квота метода загрузки.',
      'Превышена квота чатов и метода загрузки.',
      'Сработало ограничение тарифа.',
      'Сработало ограничение тарифа.',
    ]

    for (const [index, body] of bodies.entries()) {
      resetToastStore()
      cancelChatListLoad()
      establishSession(connection, 'authorized')
      const outcome = loadChatList({
        client: {
          getChats: () =>
            Promise.reject(
              new GreenApiError('http', 'quota', {
                status: 466,
                responseBody: body,
              }),
            ),
        },
      })
      await outcome

      expect(useLoadChatsStore.getState()).toMatchObject({
        status: 'error',
        errorText: chatListErrorMessage,
      })
      expect(useChatStore.getState().chatIds).toEqual(['10000000'])
      expect(toastTexts()).toEqual([notices[index]])
      expect(notices[index]).not.toMatch(/https|abc123|Анна/)
      if (index === 1 || index >= 3) {
        expect(notices[index]).not.toMatch(/чат/)
      }
    }
  })

  it('ignores a late response after leave', async () => {
    const pending = deferred<ChatDirectoryEntry[]>()
    const request = loadChatList({
      client: { getChats: () => pending.promise },
    })

    cancelChatListLoad()
    clearSession()
    pending.resolve([
      entry({ chatId: '10000000', name: 'Поздний', phoneNumber: 79991234567 }),
    ])
    await request

    expect(useChatStore.getState().chatIds).toEqual([])
    expect(useSessionStore.getState().connection).toBeNull()
    expect(useLoadChatsStore.getState().status).toBe('idle')
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('does not toast a refusal that arrives after cancel', async () => {
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: 'Анна',
      username: null,
    })
    const pending = deferred<ChatDirectoryEntry[]>()
    const request = loadChatList({
      client: { getChats: () => pending.promise },
    })

    cancelChatListLoad()
    pending.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await request

    expect(useToastStore.getState().toasts).toEqual([])
    expect(useChatStore.getState().chatIds).toEqual(['10000000'])
    expect(useLoadChatsStore.getState().status).toBe('idle')
  })

  it('does not start a second request while the first is in flight', async () => {
    let calls = 0
    const pending = deferred<ChatDirectoryEntry[]>()
    const client = {
      getChats: (): Promise<ChatDirectoryEntry[]> => {
        calls += 1
        return pending.promise
      },
    }

    const first = loadChatList({ client })
    const second = loadChatList({ client })
    expect(first).toBe(second)
    pending.resolve([])
    await first

    expect(calls).toBe(1)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('shows one toast when one in-flight load fails', async () => {
    let calls = 0
    const pending = deferred<ChatDirectoryEntry[]>()
    const client = {
      getChats: (): Promise<ChatDirectoryEntry[]> => {
        calls += 1
        return pending.promise
      },
    }

    const first = loadChatList({ client })
    const second = loadChatList({ client })
    pending.reject(new GreenApiError('network', 'offline'))
    await first
    await second

    expect(calls).toBe(1)
    expect(toastTexts()).toEqual([chatListFailureMessage])
    expect(useLoadChatsStore.getState().errorText).toBe(chatListErrorMessage)
  })
})

function toastTexts(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message)
}

function entry(patch: Partial<ChatDirectoryEntry>): ChatDirectoryEntry {
  return {
    chatId: '10000000',
    name: 'Анна',
    type: 'user',
    phoneNumber: 79991234567,
    ...patch,
  }
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => {
    throw new Error('deferred resolve is not ready')
  }
  let rejectPromise: (error: unknown) => void = () => {
    throw new Error('deferred reject is not ready')
  }
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: (value: T) => {
      resolvePromise(value)
    },
    reject: (error: unknown) => {
      rejectPromise(error)
    },
  }
}
