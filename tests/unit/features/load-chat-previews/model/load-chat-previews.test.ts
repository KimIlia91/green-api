import { beforeEach, describe, expect, it } from 'vitest'

import {
  noteUnseenIncoming,
  recordChatActivity,
  resetChats,
  selectChat,
  selectChatIds,
  upsertChat,
  useChatStore,
} from '@/entities/chat'
import {
  addMessage,
  resetMessages,
  unsupportedMessageText,
  useMessageStore,
} from '@/entities/message'
import { clearSession, establishSession } from '@/entities/session'
import { GreenApiError } from '@/shared/api'
import type { ChatHistoryEntry } from '@/shared/api'

import {
  cancelChatPreviewLoads,
  chatPreviewBackfillCount,
  chatPreviewCount,
  holdChatPreview,
  loadChatPreviews,
  retryFailedChatPreviews,
  selectChatPreviewFailed,
  skipChatPreview,
  useChatPreviewStore,
} from '@/features/load-chat-previews/model/load-chat-previews.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('loadChatPreviews', () => {
  beforeEach(() => {
    cancelChatPreviewLoads()
    resetMessages()
    resetChats()
    clearSession()
    establishSession(connection, 'authorized')
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: 'Анна',
      username: null,
    })
    upsertChat({
      chatId: '20000000',
      phoneNumber: '375291112233',
      name: 'Борис',
      username: null,
    })
    upsertChat({
      chatId: '30000000',
      phoneNumber: null,
      name: 'Вера',
      username: null,
    })
    selectChat('10000000')
  })

  it('shows the latest message without opening the chat', async () => {
    const counts: number[] = []
    await loadSettled(['10000000'], {
      getChatHistory: (params) => {
        counts.push(params.count)
        return Promise.resolve([
          entry({
            type: 'outgoing',
            text: 'последнее',
            statusMessage: 'delivered',
            timestamp: 1_700_000_010,
          }),
        ])
      },
    })

    expect(counts.every((count) => count === chatPreviewCount)).toBe(true)
    expect(counts[0]).toBe(chatPreviewCount)
    expect(useChatStore.getState().activeChatId).toBe('10000000')
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'последнее',
      lastActivityAt: 1_700_000_010_000,
      unseenIncomingIds: [],
    })
    expect(useMessageStore.getState().messagesById).toMatchObject({
      'preview-1': {
        direction: 'outgoing',
        sendState: 'delivered',
        text: 'последнее',
      },
    })
  })

  it('sorts chats after previews arrive and keeps equal times stable', async () => {
    await loadSettled(['10000000', '20000000', '30000000'], {
      getChatHistory: (params) => {
        if (params.chatId === '10000000') {
          return Promise.resolve([
            entry({
              chatId: '10000000',
              text: 'раньше',
              timestamp: 1_700_000_000,
            }),
          ])
        }
        if (params.chatId === '20000000') {
          return Promise.resolve([
            entry({
              chatId: '20000000',
              idMessage: 'provider-2',
              text: 'позже',
              timestamp: 1_700_000_020,
            }),
          ])
        }
        return Promise.resolve([
          entry({
            chatId: '30000000',
            idMessage: 'provider-3',
            text: 'вместе',
            timestamp: 1_700_000_000,
          }),
        ])
      },
    })

    expect(selectChatIds(useChatStore.getState())).toEqual([
      '20000000',
      '10000000',
      '30000000',
    ])
  })

  it('keeps an empty history without a made-up preview', async () => {
    await loadSettled(['10000000'], {
      getChatHistory: () => Promise.resolve([]),
    })

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: null,
      lastActivityAt: null,
    })
    expect(
      useMessageStore.getState().messageIdsByChatId['10000000'],
    ).toBeUndefined()
  })

  it('uses the unsupported line for a non-text history row', async () => {
    await loadSettled(['10000000'], {
      getChatHistory: () =>
        Promise.resolve([
          entry({
            typeMessage: 'imageMessage',
            text: null,
            timestamp: 1_700_000_030,
          }),
        ]),
    })

    expect(useChatStore.getState().chatsById['10000000']?.preview).toBe(
      unsupportedMessageText,
    )
    expect(useChatStore.getState().chatsById['10000000']?.lastActivityAt).toBe(
      1_700_000_030_000,
    )
  })

  it('continues after one chat fails and retries only that chat', async () => {
    const calls: string[] = []
    const client = {
      getChatHistory: (params: { chatId: string; count: number }) => {
        calls.push(params.chatId)
        if (
          params.chatId === '10000000' &&
          calls.filter((id) => id === '10000000').length === 1
        ) {
          return Promise.reject(new GreenApiError('network', 'offline'))
        }
        return Promise.resolve([
          entry({
            chatId: params.chatId,
            idMessage: params.chatId,
            text: params.chatId,
          }),
        ])
      },
    }

    loadChatPreviews(['10000000', '20000000'], { client })
    await flush(3)

    expect(useChatStore.getState().chatsById['20000000']?.preview).toBe(
      '20000000',
    )
    expect(useChatStore.getState().chatsById['10000000']?.preview).toBeNull()
    expect(selectChatPreviewFailed(useChatPreviewStore.getState())).toBe(true)

    retryFailedChatPreviews()
    await flush(4)

    expect(calls.filter((id) => id === '10000000')).toHaveLength(2)
    expect(calls.filter((id) => id === '20000000')).toHaveLength(1)
    expect(useChatStore.getState().chatsById['10000000']?.preview).toBe(
      '10000000',
    )
    expect(selectChatPreviewFailed(useChatPreviewStore.getState())).toBe(false)
  })

  it('does not let an older preview replace a newer message or a read status', async () => {
    addMessage({
      localId: 'local-live',
      providerId: 'provider-1',
      chatId: '10000000',
      text: 'уведомление',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_800_000_000_000,
      sentAt: null,
      sendState: 'read',
      errorText: null,
    })
    noteUnseenIncoming('10000000', 'provider-live')
    recordChatActivity('10000000', {
      preview: 'уведомление',
      at: 1_800_000_000_000,
    })

    await loadSettled(['10000000'], {
      getChatHistory: () =>
        Promise.resolve([
          entry({
            text: 'старое',
            statusMessage: 'sent',
            timestamp: 1_700_000_000,
          }),
        ]),
    })

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'уведомление',
      lastActivityAt: 1_800_000_000_000,
      unseenIncomingIds: ['provider-live'],
    })
    expect(
      useMessageStore.getState().messagesById['local-live']?.sendState,
    ).toBe('read')
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-live',
    ])
  })

  it('drops a late preview after leave and loads again for a new session', async () => {
    const pending = deferred<ChatHistoryEntry[]>()
    let calls = 0
    loadChatPreviews(['10000000'], {
      createId: () => 'late-preview',
      client: {
        getChatHistory: () => {
          calls += 1
          if (calls === 1) {
            return pending.promise
          }
          return Promise.resolve([
            entry({ text: 'новая сессия', timestamp: 1_700_000_040 }),
          ])
        },
      },
    })
    await Promise.resolve()

    cancelChatPreviewLoads()
    clearSession()
    pending.resolve([entry({ text: 'старая сессия' })])
    await flush(2)

    expect(
      useMessageStore.getState().messagesById['late-preview'],
    ).toBeUndefined()

    resetChats()
    establishSession(connection, 'authorized')
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: 'Анна',
      username: null,
    })
    loadChatPreviews(['10000000'])
    await flush(8)

    expect(calls).toBe(2)
    expect(useChatStore.getState().chatsById['10000000']?.preview).toBe(
      'новая сессия',
    )
  })

  it('requests visible chats before the rest and ignores repeat calls', async () => {
    const calls: string[] = []
    const gates = new Map<
      string,
      ReturnType<typeof deferred<ChatHistoryEntry[]>>
    >()
    const client = {
      getChatHistory: (params: { chatId: string }) => {
        calls.push(params.chatId)
        const gate = deferred<ChatHistoryEntry[]>()
        gates.set(params.chatId, gate)
        return gate.promise
      },
    }

    loadChatPreviews(['20000000'], { client })
    loadChatPreviews(['20000000'], { client })
    loadChatPreviews(['20000000'], { client })
    await Promise.resolve()
    expect(calls).toEqual(['20000000'])

    gates
      .get('20000000')
      ?.resolve([entry({ chatId: '20000000', idMessage: 'b', text: 'б' })])
    await flush(2)
    expect(calls).toEqual(['20000000', '10000000'])

    gates.get('10000000')?.resolve([entry({ chatId: '10000000', text: 'а' })])
    await flush(3)
    expect(calls).toEqual(['20000000', '10000000', '30000000'])

    gates.get('30000000')?.resolve([])
    await flush(4)
    loadChatPreviews(['10000000', '20000000', '30000000'], {
      client,
    })
    await flush(5)
    expect(calls).toEqual(['20000000', '10000000', '30000000'])
  })

  it('does not request a preview after the full history is already known', async () => {
    skipChatPreview('10000000')
    const calls: string[] = []
    loadChatPreviews(['10000000', '20000000'], {
      client: {
        getChatHistory: (params) => {
          calls.push(params.chatId)
          return Promise.resolve([])
        },
      },
    })
    await flush(2)

    expect(calls).toEqual(['20000000', '30000000'])
  })

  it('requests the next preview after the current one settles', async () => {
    const calls: string[] = []
    const gate = deferred<ChatHistoryEntry[]>()
    loadChatPreviews(['10000000', '20000000'], {
      client: {
        getChatHistory: (params) => {
          calls.push(params.chatId)
          if (params.chatId === '10000000') {
            return gate.promise
          }
          return Promise.resolve([])
        },
      },
    })
    await Promise.resolve()
    expect(calls).toEqual(['10000000'])

    gate.resolve([])
    await flush(4)

    expect(calls).toEqual(['10000000', '20000000', '30000000'])
  })

  it('holds the open chat until its full history fails', async () => {
    const calls: string[] = []
    holdChatPreview('10000000')
    loadChatPreviews(['10000000', '20000000'], {
      client: {
        getChatHistory: (params) => {
          calls.push(params.chatId)
          return Promise.resolve([
            entry({
              chatId: params.chatId,
              idMessage: params.chatId,
              text: params.chatId,
            }),
          ])
        },
      },
    })
    await flush(8)

    expect(calls).toEqual(['20000000', '30000000'])
    expect(useChatStore.getState().chatsById['10000000']?.preview).toBeNull()
  })

  it('does not turn an edit event into the chat preview or a new message', async () => {
    addMessage({
      localId: 'local-original',
      providerId: 'provider-1',
      chatId: '10000000',
      text: 'Было',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_700_000_000_000,
      sentAt: 1_700_000_000_000,
      sendState: 'sent',
      errorText: null,
    })
    recordChatActivity('10000000', { preview: 'Было', at: 1_700_000_000_000 })
    recordChatActivity('20000000', { preview: 'позже', at: 1_800_000_000_000 })
    const order = selectChatIds(useChatStore.getState())

    await loadSettled(['10000000'], {
      getChatHistory: (params) => {
        expect(params.count).toBe(chatPreviewCount)
        return Promise.resolve([
          entry({
            type: 'outgoing',
            idMessage: 'event-1',
            timestamp: 1_700_000_050,
            typeMessage: 'editedMessage',
            text: null,
            editEvent: { originalId: 'provider-1', text: 'Стало' },
          }),
        ])
      },
    })

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-original',
    ])
    expect(
      useMessageStore.getState().messagesById['local-original'],
    ).toMatchObject({
      text: 'Стало',
      sentAt: 1_700_000_000_000,
      edited: true,
    })
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Стало',
      lastActivityAt: 1_700_000_000_000,
      unseenIncomingIds: [],
    })
    expect(selectChatIds(useChatStore.getState())).toEqual(order)
  })

  it('backfills once when the newest history row is only a reaction', async () => {
    const counts: number[] = []
    await loadSettled(['10000000'], {
      getChatHistory: (params) => {
        counts.push(params.count)
        if (params.count === chatPreviewCount) {
          return Promise.resolve([
            entry({
              type: 'outgoing',
              idMessage: 'event-reaction',
              timestamp: 1_700_000_050,
              typeMessage: 'reactionMessage',
              text: null,
              reaction: { targetId: 'provider-text', emoji: '👍' },
            }),
          ])
        }
        return Promise.resolve([
          entry({
            type: 'outgoing',
            idMessage: 'provider-text',
            timestamp: 1_700_000_000,
            text: 'Обычное',
          }),
          entry({
            type: 'outgoing',
            idMessage: 'event-reaction',
            timestamp: 1_700_000_050,
            typeMessage: 'reactionMessage',
            text: null,
            reaction: { targetId: 'provider-text', emoji: '👍' },
          }),
        ])
      },
    })

    expect(counts.slice(0, 2)).toEqual([
      chatPreviewCount,
      chatPreviewBackfillCount,
    ])
    expect(
      counts.filter((count) => count === chatPreviewBackfillCount),
    ).toEqual([chatPreviewBackfillCount])
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Обычное',
      lastActivityAt: 1_700_000_000_000,
    })
    expect(
      useMessageStore.getState().localIdByProviderId['event-reaction'],
    ).toBeUndefined()
    expect(
      Object.values(useMessageStore.getState().messagesById).map(
        (message) => message.providerId,
      ),
    ).toEqual(['provider-text'])
  })

  it('marks a forwarded last message from preview history and clears it for the next plain one', async () => {
    await loadSettled(['10000000'], {
      getChatHistory: () =>
        Promise.resolve([
          entry({
            type: 'outgoing',
            text: 'Пересланный текст',
            timestamp: 1_700_000_010,
            forwarded: true,
            forwardingScore: 2,
          }),
        ]),
    })

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Пересланный текст',
      previewForwarded: true,
    })
    expect(useMessageStore.getState().messagesById).toMatchObject({
      'preview-1': { forwarded: true },
    })

    cancelChatPreviewLoads()
    loadChatPreviews(['10000000'], {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              type: 'incoming',
              idMessage: 'provider-plain',
              text: 'Обычное',
              timestamp: 1_700_000_020,
              forwarded: false,
            }),
          ]),
      },
      createId: sequence('later'),
    })
    await flush(12)

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Обычное',
      previewForwarded: false,
    })
  })
})

function loadSettled(
  priority: string[],
  client: {
    getChatHistory: (params: {
      chatId: string
      count: number
    }) => Promise<ChatHistoryEntry[]>
  },
): Promise<void> {
  loadChatPreviews(priority, {
    client,
    createId: sequence('preview'),
  })
  return flush(12)
}

function entry(
  patch: Partial<ChatHistoryEntry> & { text?: string | null },
): ChatHistoryEntry {
  const { text: textValue, ...rest } = patch
  return {
    type: 'incoming',
    idMessage: 'provider-1',
    timestamp: 1_700_000_000,
    chatId: '10000000',
    typeMessage: 'textMessage',
    text: textValue === undefined ? 'последнее' : textValue,
    statusMessage: null,
    stickerUrl: null,
    stickerMimeType: null,
    isEdited: false,
    editedMessageId: null,
    editEvent: null,
    reaction: null,
    deletion: null,
    deleted: false,
    deletedMessageId: null,
    forwarded: false,
    forwardingScore: null,
    ...rest,
    quote: rest.quote ?? null,
  }
}

function sequence(prefix: string): () => string {
  let index = 0
  return () => {
    index += 1
    return `${prefix}-${String(index)}`
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolvePromise: (value: T) => void = () => {
    throw new Error('deferred resolve is not ready')
  }
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value: T) => {
      resolvePromise(value)
    },
  }
}

async function flush(steps: number): Promise<void> {
  for (let index = 0; index < steps; index += 1) {
    await Promise.resolve()
  }
}
