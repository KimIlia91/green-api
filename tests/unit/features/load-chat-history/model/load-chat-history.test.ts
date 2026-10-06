import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  markIncomingViewed,
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
import {
  clearSession,
  establishSession,
  sessionCredentialStorageKey,
} from '@/entities/session'
import { GreenApiError } from '@/shared/api'
import type { ChatHistoryEntry } from '@/shared/api'
import { resetToastStore, useToastStore } from '@/shared/lib/toast'

import {
  cancelChatHistoryLoads,
  chatHistoryCount,
  chatHistoryErrorMessage,
  chatHistoryFailureMessage,
  chatHistoryRefreshErrorMessage,
  loadChatHistory,
  useLoadHistoryStore,
} from '@/features/load-chat-history/model/load-chat-history.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('loadChatHistory', () => {
  beforeEach(() => {
    resetToastStore()
    cancelChatHistoryLoads()
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
  })

  it('merges a send and a notification that arrive while history is loading', async () => {
    const pending = deferred<ChatHistoryEntry[]>()
    let calls = 0
    const request = loadChatHistory('10000000', {
      client: {
        getChatHistory: (params) => {
          calls += 1
          expect(params).toEqual({
            chatId: '10000000',
            count: chatHistoryCount,
          })
          return pending.promise
        },
      },
      createId: sequence('history'),
    })

    addMessage({
      localId: 'local-send',
      providerId: null,
      chatId: '10000000',
      text: 'локальное',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 9_000,
      sentAt: null,
      sendState: 'sending',
      errorText: null,
    })
    addMessage({
      localId: 'local-live',
      providerId: 'provider-live',
      chatId: '10000000',
      text: 'живое',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'incoming',
      createdAt: 1_700_000_002_000,
      sentAt: null,
      sendState: null,
      errorText: null,
    })
    noteUnseenIncoming('10000000', 'provider-live')
    recordChatActivity('10000000', {
      preview: 'живое',
      at: 1_700_000_002_000,
    })

    pending.resolve([
      entry({
        idMessage: 'provider-old',
        timestamp: 1_700_000_000,
        textMessage: 'старое',
        statusMessage: 'sent',
      }),
      entry({
        type: 'incoming',
        idMessage: 'provider-live',
        timestamp: 1_700_000_002,
        textMessage: 'живое',
        statusMessage: null,
      }),
      entry({
        idMessage: 'provider-read',
        timestamp: 1_700_000_001,
        textMessage: 'прочитано',
        statusMessage: 'delivered',
      }),
      entry({
        idMessage: 'provider-file',
        timestamp: 1_700_000_003,
        typeMessage: 'stickerMessage',
        statusMessage: 'sent',
      }),
    ])
    await request

    const messages = useMessageStore.getState()
    expect(calls).toBe(1)
    expect(messages.localIdByProviderId['provider-live']).toBe('local-live')
    expect(messages.messagesById['local-send']).toMatchObject({
      text: 'локальное',
      sendState: 'sending',
    })
    expect(messages.messagesById['history-1']?.sendState).toBe('sent')
    expect(
      Object.values(messages.messagesById).some(
        (message) => message.text === unsupportedMessageText,
      ),
    ).toBe(true)
    expect(messages.messageIdsByChatId['20000000']).toBeUndefined()
    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual(['provider-live'])
    markIncomingViewed('10000000', ['provider-live'])

    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () => {
          calls += 1
          return Promise.resolve([])
        },
      },
    })
    expect(calls).toBe(1)
    expect(useLoadHistoryStore.getState().phaseByChatId['10000000']).toBe(
      'ready',
    )

    await loadChatHistory('10000000', {
      refresh: true,
      client: {
        getChatHistory: () => {
          calls += 1
          return Promise.resolve([
            entry({
              type: 'incoming',
              idMessage: 'provider-live',
              timestamp: 1_700_000_002,
              textMessage: 'живое',
              statusMessage: null,
            }),
          ])
        },
      },
    })
    expect(calls).toBe(2)
    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual([])
  })

  it('does not roll read back to delivered and keeps the open chat separate', async () => {
    addMessage({
      localId: 'local-read',
      providerId: 'provider-read',
      chatId: '10000000',
      text: 'прочитано',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_700_000_001_000,
      sentAt: null,
      sendState: 'read',
      errorText: null,
    })

    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              idMessage: 'provider-read',
              timestamp: 1_700_000_001,
              textMessage: 'прочитано',
              statusMessage: 'delivered',
            }),
          ]),
      },
    })
    await loadChatHistory('20000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              chatId: '20000000',
              idMessage: 'provider-other',
              timestamp: 1_700_000_010,
              textMessage: 'другой чат',
              statusMessage: 'sent',
            }),
          ]),
      },
      createId: () => 'other-1',
    })

    expect(
      useMessageStore.getState().messagesById['local-read']?.sendState,
    ).toBe('read')
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-read',
    ])
    expect(useMessageStore.getState().messageIdsByChatId['20000000']).toEqual([
      'other-1',
    ])
  })

  it('keeps messages when loading fails and succeeds on retry', async () => {
    addMessage({
      localId: 'local-1',
      providerId: null,
      chatId: '10000000',
      text: 'уже есть',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1,
      sentAt: null,
      sendState: 'sending',
      errorText: null,
    })
    let calls = 0
    const client = {
      getChatHistory: (): Promise<ChatHistoryEntry[]> => {
        calls += 1
        if (calls === 1) {
          return Promise.reject(new GreenApiError('network', 'offline'))
        }
        return Promise.resolve([
          entry({
            idMessage: 'provider-1',
            timestamp: 1_700_000_000,
            textMessage: 'из истории',
            statusMessage: 'read',
          }),
        ])
      },
    }

    selectChat('10000000')
    await loadChatHistory('10000000', { client, createId: () => 'history-1' })
    expect(useLoadHistoryStore.getState().errorByChatId['10000000']).toBe(
      chatHistoryErrorMessage,
    )
    expect(chatHistoryErrorMessage).toBe('История не загружена')
    expect(toastTexts()).toEqual([chatHistoryFailureMessage])
    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      text: 'уже есть',
      sendState: 'sending',
    })

    await loadChatHistory('10000000', {
      client,
      refresh: true,
      createId: () => 'history-1',
    })
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
      'history-1',
    ])
    expect(useLoadHistoryStore.getState().phaseByChatId['10000000']).toBe(
      'ready',
    )
    expect(useLoadHistoryStore.getState().errorByChatId['10000000']).toBe(
      undefined,
    )
    expect(toastTexts()).toEqual([chatHistoryFailureMessage])
    expect(useMessageStore.getState().messagesById['local-1']?.sendState).toBe(
      'sending',
    )
  })

  it('joins a refresh with the request already in flight', async () => {
    let calls = 0
    const pending = deferred<ChatHistoryEntry[]>()
    const client = {
      getChatHistory: (): Promise<ChatHistoryEntry[]> => {
        calls += 1
        return pending.promise
      },
    }

    const first = loadChatHistory('10000000', { client })
    const second = loadChatHistory('10000000', { client, refresh: true })
    expect(second).toBe(first)
    pending.resolve([])
    await first
    expect(calls).toBe(1)
  })

  it('ignores a late history response after leave', async () => {
    const pending = deferred<ChatHistoryEntry[]>()
    const request = loadChatHistory('10000000', {
      client: { getChatHistory: () => pending.promise },
      createId: () => 'late-1',
    })

    cancelChatHistoryLoads()
    clearSession()
    pending.resolve([
      entry({
        idMessage: 'provider-late',
        timestamp: 1_700_000_000,
        textMessage: 'поздно',
        statusMessage: 'sent',
      }),
    ])
    await request

    expect(useMessageStore.getState().messagesById['late-1']).toBeUndefined()
    expect(
      useLoadHistoryStore.getState().phaseByChatId['10000000'],
    ).toBeUndefined()
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('does not roll activity back when older history arrives', async () => {
    recordChatActivity('10000000', {
      preview: 'Новое',
      at: 1_800_000_000_000,
    })
    recordChatActivity('20000000', {
      preview: 'Раньше',
      at: 1_700_000_000_000,
    })
    const order = selectChatIds(useChatStore.getState())

    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              idMessage: 'provider-old',
              timestamp: 1_700_000_000,
              textMessage: 'Старое',
              statusMessage: 'read',
            }),
          ]),
      },
      createId: () => 'history-old',
    })

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Новое',
      lastActivityAt: 1_800_000_000_000,
    })
    expect(selectChatIds(useChatStore.getState())).toBe(order)
  })

  it('shows a sticker from history and previews it as a sticker', async () => {
    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              type: 'incoming',
              idMessage: 'sticker-1',
              timestamp: 1_700_000_010,
              typeMessage: 'stickerMessage',
              statusMessage: null,
              stickerUrl: 'https://media.example/sticker.png',
              stickerMimeType: 'image/png',
            }),
          ]),
      },
      createId: () => 'history-sticker',
    })

    expect(
      useMessageStore.getState().messagesById['history-sticker'],
    ).toMatchObject({
      text: '',
      stickerUrl: 'https://media.example/sticker.png',
      direction: 'incoming',
    })
    expect(useChatStore.getState().chatsById['10000000']?.preview).toBe(
      'Стикер',
    )
    expect(
      useChatStore.getState().chatsById['10000000']?.previewForwarded,
    ).toBe(false)
  })

  it('keeps the forward mark when the latest history message is a sticker', async () => {
    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              type: 'outgoing',
              idMessage: 'sticker-forward',
              timestamp: 1_700_000_010,
              typeMessage: 'stickerMessage',
              text: null,
              statusMessage: 'delivered',
              stickerUrl: 'https://media.example/sticker.webp',
              stickerMimeType: 'image/webp',
              forwarded: true,
              forwardingScore: 1,
            }),
          ]),
      },
      createId: () => 'history-sticker-forward',
    })

    expect(
      useMessageStore.getState().messagesById['history-sticker-forward'],
    ).toMatchObject({
      forwarded: true,
      text: '',
    })
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Стикер',
      previewForwarded: true,
    })
  })

  it('applies an edit event from history without a new bubble or a new activity time', async () => {
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
      sendState: 'read',
      errorText: null,
      quote: {
        sourceId: 'quote-1',
        excerpt: 'цитата',
        authorName: null,
        typeMessage: 'textMessage',
      },
    })
    addMessage({
      localId: 'local-stub',
      providerId: 'event-1',
      chatId: '10000000',
      text: unsupportedMessageText,
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_700_000_020_000,
      sentAt: 1_700_000_020_000,
      sendState: 'sent',
      errorText: null,
    })
    addMessage({
      localId: 'local-own',
      providerId: 'own-1',
      chatId: '10000000',
      text: unsupportedMessageText,
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_600_000_000_000,
      sentAt: 1_600_000_000_000,
      sendState: 'sent',
      errorText: null,
    })
    recordChatActivity('10000000', {
      preview: unsupportedMessageText,
      at: 1_700_000_020_000,
    })
    recordChatActivity('20000000', { preview: 'Борис', at: 1_800_000_000_000 })
    const order = selectChatIds(useChatStore.getState())

    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              idMessage: 'provider-1',
              timestamp: 1_700_000_000,
              textMessage: 'Стало',
              statusMessage: 'read',
              isEdited: true,
              editedMessageId: 'provider-1',
            }),
            entry({
              idMessage: 'event-1',
              timestamp: 1_700_000_020,
              typeMessage: 'editedMessage',
              textMessage: 'Стало',
              editEvent: {
                originalId: 'provider-1',
                text: 'Стало',
              },
            }),
            entry({
              idMessage: 'image-1',
              timestamp: 1_500_000_000,
              typeMessage: 'imageMessage',
              text: null,
              statusMessage: null,
            }),
            entry({
              idMessage: 'own-1',
              timestamp: 1_600_000_000,
              textMessage: unsupportedMessageText,
            }),
          ]),
      },
      createId: sequence('history'),
      refresh: true,
    })

    const state = useMessageStore.getState()
    expect(state.messageIdsByChatId['10000000']).toEqual([
      'history-1',
      'local-own',
      'local-original',
    ])
    expect(state.messagesById['local-stub']).toBeUndefined()
    expect(state.messagesById['local-original']).toMatchObject({
      localId: 'local-original',
      providerId: 'provider-1',
      text: 'Стало',
      sentAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
      sendState: 'read',
      edited: true,
      quote: { sourceId: 'quote-1', excerpt: 'цитата' },
    })
    expect(state.messagesById['local-own']?.text).toBe(unsupportedMessageText)
    expect(state.messagesById['history-1']?.text).toBe(unsupportedMessageText)
    expect(state.localIdByProviderId['event-1']).toBeUndefined()
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Стало',
      lastActivityAt: 1_700_000_000_000,
      unseenIncomingIds: [],
    })
    expect(selectChatIds(useChatStore.getState())).toEqual(order)

    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              idMessage: 'provider-1',
              timestamp: 1_700_000_050,
              textMessage: 'Повтор',
              isEdited: true,
            }),
            entry({
              idMessage: 'event-2',
              timestamp: 1_700_000_060,
              typeMessage: 'editedMessage',
              editEvent: { originalId: null, text: 'некуда' },
            }),
          ]),
      },
      createId: sequence('again'),
      refresh: true,
    })

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'history-1',
      'local-own',
      'local-original',
    ])
    expect(
      useMessageStore.getState().messagesById['local-original'],
    ).toMatchObject({
      text: 'Повтор',
      sentAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    })
    expect(useChatStore.getState().chatsById['10000000']?.lastActivityAt).toBe(
      1_700_000_000_000,
    )
  })

  it('keeps a forward mark through history refresh and an edit, then drops it', async () => {
    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              type: 'incoming',
              idMessage: 'provider-fwd',
              timestamp: 1_700_000_010,
              textMessage: 'Пересланный текст',
              forwarded: true,
              forwardingScore: 1,
            }),
          ]),
      },
      createId: sequence('history'),
    })

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Пересланный текст',
      previewForwarded: true,
    })

    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              type: 'incoming',
              idMessage: 'provider-fwd',
              timestamp: 1_700_000_010,
              textMessage: 'После правки',
              isEdited: true,
              forwarded: true,
            }),
            entry({
              idMessage: 'event-1',
              timestamp: 1_700_000_020,
              typeMessage: 'editedMessage',
              editEvent: {
                originalId: 'provider-fwd',
                text: 'После правки',
              },
            }),
          ]),
      },
      createId: sequence('edit'),
      refresh: true,
    })

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'После правки',
      previewForwarded: true,
    })

    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              type: 'outgoing',
              idMessage: 'provider-plain',
              timestamp: 1_700_000_030,
              textMessage: 'Обычное',
              forwarded: false,
            }),
          ]),
      },
      createId: sequence('plain'),
      refresh: true,
    })

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Обычное',
      previewForwarded: false,
    })
  })

  it('does not turn a history reaction or deletion into a bubble or the preview', async () => {
    addMessage({
      localId: 'local-own',
      providerId: 'provider-text',
      chatId: '10000000',
      text: 'Обычное',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_700_000_000_000,
      sentAt: 1_700_000_000_000,
      sendState: 'sent',
      errorText: null,
    })
    addMessage({
      localId: 'local-failed',
      providerId: null,
      chatId: '10000000',
      text: 'не ушло',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_600_000_000_000,
      sentAt: 1_600_000_000_000,
      sendState: 'failed',
      errorText: 'сеть',
    })
    recordChatActivity('10000000', {
      preview: unsupportedMessageText,
      at: 1_700_000_050_000,
    })

    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              idMessage: 'provider-text',
              timestamp: 1_700_000_000,
              textMessage: 'Обычное',
            }),
            entry({
              idMessage: 'provider-literal',
              timestamp: 1_700_000_010,
              textMessage: unsupportedMessageText,
            }),
            entry({
              idMessage: 'provider-file',
              timestamp: 1_700_000_020,
              typeMessage: 'imageMessage',
              text: null,
            }),
            entry({
              idMessage: 'event-reaction',
              timestamp: 1_700_000_050,
              typeMessage: 'reactionMessage',
              text: null,
              reaction: { targetId: 'provider-text', emoji: '👍' },
            }),
            entry({
              idMessage: 'provider-gone',
              timestamp: 1_700_000_030,
              textMessage: 'скрыто',
              deleted: true,
              deletedMessageId: 'provider-gone',
            }),
          ]),
      },
      createId: sequence('history'),
    })

    const state = useMessageStore.getState()
    expect(state.localIdByProviderId['event-reaction']).toBeUndefined()
    expect(state.localIdByProviderId['provider-gone']).toBeUndefined()
    expect(state.messagesById['local-failed']?.sendState).toBe('failed')
    expect(
      Object.values(state.messagesById).filter(
        (message) => message.providerId === 'provider-literal',
      ),
    ).toMatchObject([{ text: unsupportedMessageText }])
    expect(
      Object.values(state.messagesById).filter(
        (message) => message.providerId === 'provider-file',
      ),
    ).toMatchObject([{ text: unsupportedMessageText }])
    expect(state.messagesById['local-own']?.reactions).toEqual([
      { sourceId: 'event-reaction', emoji: '👍', eventAt: 1_700_000_050_000 },
    ])
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: unsupportedMessageText,
      lastActivityAt: 1_700_000_020_000,
      unseenIncomingIds: [],
    })
  })

  it('keeps a deletion tombstone when a later history row repeats the original', async () => {
    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              idMessage: 'event-delete',
              timestamp: 1_700_000_040,
              typeMessage: 'deletedMessage',
              text: null,
              deletion: { targetId: 'provider-1' },
            }),
          ]),
      },
      createId: () => 'should-not-create',
    })

    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.resolve([
            entry({
              idMessage: 'provider-1',
              timestamp: 1_700_000_000,
              textMessage: 'вернулось',
            }),
          ]),
      },
      createId: () => 'restored',
      refresh: true,
    })

    expect(useMessageStore.getState().localIdByProviderId['provider-1']).toBe(
      undefined,
    )
    expect(
      useMessageStore.getState().localIdByProviderId['event-delete'],
    ).toBeUndefined()

    const sessionSet = vi.fn<(key: string, value: string) => void>()
    const localSet = vi.fn<(key: string, value: string) => void>()
    vi.stubGlobal('sessionStorage', {
      setItem: sessionSet,
      removeItem: vi.fn(),
      getItem: () => null,
    })
    vi.stubGlobal('localStorage', {
      setItem: localSet,
      removeItem: vi.fn(),
      getItem: () => null,
    })
    try {
      resetMessages()
      clearSession()
      establishSession(connection, 'authorized')
      expect(localSet).not.toHaveBeenCalled()
      expect(sessionSet.mock.calls.map((call) => call[0])).toEqual([
        sessionCredentialStorageKey,
      ])
      const stored = sessionSet.mock.calls.map((call) => call[1]).join('\n')
      expect(stored).not.toContain('скрыто')
      expect(stored).not.toContain('provider-1')
      await loadChatHistory('10000000', {
        client: {
          getChatHistory: () =>
            Promise.resolve([
              entry({
                idMessage: 'provider-1',
                timestamp: 1_700_000_000,
                textMessage: 'скрыто',
                deleted: true,
              }),
            ]),
        },
        createId: () => 'after-reload',
        refresh: true,
      })
      expect(useMessageStore.getState().localIdByProviderId['provider-1']).toBe(
        undefined,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not present the first failed load as an empty history', async () => {
    selectChat('10000000')
    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.reject(new GreenApiError('network', 'offline')),
      },
    })

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toBe(
      undefined,
    )
    expect(useLoadHistoryStore.getState()).toMatchObject({
      phaseByChatId: { '10000000': 'error' },
      errorByChatId: { '10000000': chatHistoryErrorMessage },
    })
    expect(toastTexts()).toEqual([chatHistoryFailureMessage])
  })

  it('keeps messages when a refresh fails and does not toast after leaving the chat', async () => {
    selectChat('10000000')
    addMessage({
      localId: 'local-1',
      providerId: 'provider-1',
      chatId: '10000000',
      text: 'уже есть',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_700_000_000_000,
      sentAt: 1_700_000_000_000,
      sendState: 'read',
      errorText: null,
    })
    await loadChatHistory('10000000', {
      client: { getChatHistory: () => Promise.resolve([]) },
    })
    expect(useToastStore.getState().toasts).toEqual([])

    await loadChatHistory('10000000', {
      refresh: true,
      client: {
        getChatHistory: () =>
          Promise.reject(new GreenApiError('timeout', 'timed out')),
      },
    })
    expect(useLoadHistoryStore.getState().errorByChatId['10000000']).toBe(
      chatHistoryRefreshErrorMessage,
    )
    expect(chatHistoryRefreshErrorMessage).toBe('Не удалось обновить историю')
    expect(toastTexts()).toEqual([chatHistoryFailureMessage])
    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      text: 'уже есть',
      sendState: 'read',
    })

    resetToastStore()
    const pending = deferred<ChatHistoryEntry[]>()
    const request = loadChatHistory('10000000', {
      refresh: true,
      client: { getChatHistory: () => pending.promise },
    })
    selectChat('20000000')
    pending.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await request

    expect(useToastStore.getState().toasts).toEqual([])
    expect(useLoadHistoryStore.getState().errorByChatId['10000000']).toBe(
      chatHistoryRefreshErrorMessage,
    )
    expect(useMessageStore.getState().messagesById['local-1']?.sendState).toBe(
      'read',
    )
  })

  it('classifies HTTP 466 for history without calling every body a chat quota', async () => {
    selectChat('10000000')
    addMessage({
      localId: 'local-1',
      providerId: null,
      chatId: '10000000',
      text: 'Секрет',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1,
      sentAt: null,
      sendState: 'queued',
      errorText: null,
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
      'Превышена квота метода загрузки истории.',
      'Превышена квота чатов и метода загрузки истории.',
      'Сработало ограничение тарифа.',
      'Сработало ограничение тарифа.',
    ]

    for (const [index, body] of bodies.entries()) {
      resetToastStore()
      cancelChatHistoryLoads()
      establishSession(connection, 'authorized')
      selectChat('10000000')
      await loadChatHistory('10000000', {
        client: {
          getChatHistory: () =>
            Promise.reject(
              new GreenApiError('http', 'quota', {
                status: 466,
                responseBody: body,
              }),
            ),
        },
      })

      expect(useLoadHistoryStore.getState().errorByChatId['10000000']).toBe(
        chatHistoryErrorMessage,
      )
      expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
        text: 'Секрет',
        sendState: 'queued',
      })
      expect(toastTexts()).toEqual([notices[index]])
      expect(notices[index]).not.toMatch(/https|abc123|Секрет/)
      if (index === 1 || index >= 3) {
        expect(notices[index]).not.toMatch(/чат/)
      }
    }
  })

  it('does not toast a history refusal that arrives after cancel', async () => {
    selectChat('10000000')
    const pending = deferred<ChatHistoryEntry[]>()
    const request = loadChatHistory('10000000', {
      client: { getChatHistory: () => pending.promise },
    })

    cancelChatHistoryLoads()
    pending.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await request

    expect(useToastStore.getState().toasts).toEqual([])
    expect(
      useLoadHistoryStore.getState().phaseByChatId['10000000'],
    ).toBeUndefined()
  })
})

function toastTexts(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message)
}

function entry(
  patch: Partial<ChatHistoryEntry> & { textMessage?: string },
): ChatHistoryEntry {
  const { textMessage, ...rest } = patch
  return {
    type: 'outgoing',
    idMessage: 'provider-1',
    timestamp: 1_700_000_000,
    chatId: '10000000',
    typeMessage: 'textMessage',
    text: textMessage === undefined ? null : textMessage,
    statusMessage: 'sent',
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
