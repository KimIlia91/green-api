import { beforeEach, describe, expect, it } from 'vitest'

import { unsupportedMessageText } from '@/entities/message/model/message-copy.ts'
import {
  addMessage,
  mergeChatHistory,
  useMessageStore,
} from '@/entities/message/model/message.store.ts'
import type { HistoryMessageDraft } from '@/entities/message/model/message.types.ts'

describe('mergeChatHistory', () => {
  beforeEach(() => {
    useMessageStore.getState().reset()
  })

  it('keeps localId, local rows, and does not roll a status backward', () => {
    addMessage({
      localId: 'local-read',
      providerId: 'provider-read',
      chatId: '10000000',
      text: 'прочитано',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 3_000,
      sentAt: null,
      sendState: 'read',
      errorText: null,
    })
    addMessage({
      localId: 'local-sending',
      providerId: null,
      chatId: '10000000',
      text: 'ещё отправляется',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 4_000,
      sentAt: null,
      sendState: 'sending',
      errorText: null,
    })
    addMessage({
      localId: 'local-failed',
      providerId: null,
      chatId: '10000000',
      text: 'ошибка',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 5_000,
      sentAt: null,
      sendState: 'failed',
      errorText: 'Не отправлено',
    })

    mergeChatHistory(
      '10000000',
      [
        draft({
          providerId: 'provider-read',
          text: 'прочитано',
          createdAt: 3_000,
          sentAt: null,
          sendState: 'delivered',
        }),
        draft({
          providerId: 'provider-old',
          text: 'старое',
          createdAt: 1_000,
          sentAt: null,
          sendState: 'sent',
        }),
        draft({
          providerId: 'provider-file',
          text: unsupportedMessageText,
          createdAt: 2_000,
          sentAt: null,
          sendState: 'sent',
        }),
        draft({
          providerId: 'provider-read',
          text: 'дубль',
          createdAt: 3_000,
          sentAt: null,
          sendState: 'sent',
        }),
      ],
      sequence('history'),
    )

    const state = useMessageStore.getState()
    expect(state.localIdByProviderId['provider-read']).toBe('local-read')
    expect(state.messagesById['local-read']?.sendState).toBe('read')
    expect(state.messagesById['local-sending']).toMatchObject({
      sendState: 'sending',
      text: 'ещё отправляется',
    })
    expect(state.messagesById['local-failed']?.errorText).toBe('Не отправлено')
    expect(state.messageIdsByChatId['10000000']).toEqual([
      'history-1',
      'history-2',
      'local-read',
      'local-sending',
      'local-failed',
    ])
    expect(state.messagesById['history-2']?.text).toBe(unsupportedMessageText)
    expect(state.messagesById['history-1']?.sendState).toBe('sent')
  })

  it('keeps a message that arrived during the load and upgrades queued to read', () => {
    addMessage({
      localId: 'local-live',
      providerId: 'provider-live',
      chatId: '10000000',
      text: 'во время загрузки',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'incoming',
      createdAt: 9_000,
      sentAt: null,
      sendState: null,
      errorText: null,
    })
    addMessage({
      localId: 'local-queued',
      providerId: 'provider-queued',
      chatId: '10000000',
      text: 'в очереди',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 8_000,
      sentAt: null,
      sendState: 'queued',
      errorText: null,
    })

    mergeChatHistory(
      '10000000',
      [
        draft({
          providerId: 'provider-queued',
          text: 'в очереди',
          createdAt: 8_000,
          sentAt: null,
          sendState: 'read',
        }),
        draft({
          providerId: 'provider-other',
          chatId: '20000000',
          text: 'чужой',
          createdAt: 1,
          sentAt: null,
          sendState: null,
          direction: 'incoming',
        }),
      ],
      sequence('late'),
    )

    const state = useMessageStore.getState()
    expect(state.messagesById['local-live']?.text).toBe('во время загрузки')
    expect(state.messagesById['local-queued']).toMatchObject({
      localId: 'local-queued',
      sendState: 'read',
    })
    expect(state.messageIdsByChatId['20000000']).toBeUndefined()
    expect(state.messageIdsByChatId['10000000']).toEqual([
      'local-queued',
      'local-live',
    ])
  })

  it('replaces an unsupported row with a sticker that shares its provider id', () => {
    addMessage({
      localId: 'local-sticker',
      providerId: 'provider-sticker',
      chatId: '10000000',
      text: unsupportedMessageText,
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'incoming',
      createdAt: 2_000,
      sentAt: null,
      sendState: null,
      errorText: null,
    })

    mergeChatHistory(
      '10000000',
      [
        draft({
          providerId: 'provider-sticker',
          text: '',
          stickerUrl: 'https://media.example/sticker.png',
          stickerMimeType: 'image/png',
          direction: 'incoming',
          createdAt: 2_000,
          sentAt: null,
          sendState: null,
        }),
      ],
      sequence('sticker'),
    )

    expect(
      useMessageStore.getState().messagesById['local-sticker'],
    ).toMatchObject({
      localId: 'local-sticker',
      text: '',
      stickerUrl: 'https://media.example/sticker.png',
      stickerMimeType: 'image/png',
    })
  })

  it('keeps a known quote when a later history row omits it', () => {
    addMessage({
      localId: 'local-reply',
      providerId: '1763115112345',
      chatId: '10000000',
      text: 'Цитируем это',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 5_000,
      sentAt: null,
      sendState: 'read',
      errorText: null,
      quote: {
        sourceId: '116413118178426437',
        excerpt: 'исходный текст',
        authorName: 'Вы',
        typeMessage: 'textMessage',
      },
    })

    mergeChatHistory(
      '10000000',
      [
        draft({
          providerId: '1763115112345',
          text: 'Цитируем это',
          createdAt: 5_000,
          sentAt: null,
          sendState: 'sent',
          quote: null,
        }),
      ],
      sequence('reply'),
    )

    const message = useMessageStore.getState().messagesById['local-reply']
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-reply',
    ])
    expect(message).toMatchObject({
      localId: 'local-reply',
      text: 'Цитируем это',
      sendState: 'read',
      quote: {
        sourceId: '116413118178426437',
        excerpt: 'исходный текст',
        authorName: 'Вы',
      },
    })
  })

  it('fills a missing quote from history without replacing the message text', () => {
    addMessage({
      localId: 'local-reply',
      providerId: '1763115112345',
      chatId: '10000000',
      text: 'Цитируем это',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'incoming',
      createdAt: 5_000,
      sentAt: null,
      sendState: null,
      errorText: null,
    })

    mergeChatHistory(
      '10000000',
      [
        draft({
          providerId: '1763115112345',
          text: 'Цитируем это',
          direction: 'incoming',
          createdAt: 5_000,
          sentAt: null,
          sendState: null,
          quote: {
            sourceId: '116413118178426437',
            excerpt: 'исходный текст',
            authorName: null,
            typeMessage: 'textMessage',
          },
        }),
      ],
      sequence('fill'),
    )

    expect(
      useMessageStore.getState().messagesById['local-reply'],
    ).toMatchObject({
      localId: 'local-reply',
      text: 'Цитируем это',
      quote: { excerpt: 'исходный текст', sourceId: '116413118178426437' },
    })
  })

  it('keeps the original sentAt when a later history row has another timestamp', () => {
    addMessage({
      localId: 'local-sent',
      providerId: 'provider-sent',
      chatId: '10000000',
      text: 'Исходный',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 5_000,
      sentAt: 5_000,
      sendState: 'sent',
      errorText: null,
    })

    mergeChatHistory(
      '10000000',
      [
        draft({
          providerId: 'provider-sent',
          text: 'После правки',
          createdAt: 9_000,
          sentAt: 9_000,
        }),
      ],
      sequence('sent'),
    )

    expect(useMessageStore.getState().messagesById['local-sent']).toMatchObject(
      {
        text: 'После правки',
        sentAt: 5_000,
      },
    )
  })

  it('keeps a sticker picture when later history has an empty downloadUrl', () => {
    addMessage({
      localId: 'local-sticker',
      providerId: 'sticker-live',
      chatId: '10000000',
      text: '',
      stickerUrl: 'https://media.example/sticker.png',
      stickerMimeType: 'image/png',
      direction: 'outgoing',
      createdAt: 1_700_000_000_000,
      sentAt: 1_700_000_000_000,
      sendState: 'delivered',
      errorText: null,
    })

    mergeChatHistory(
      '10000000',
      [
        draft({
          providerId: 'sticker-live',
          text: unsupportedMessageText,
          stickerUrl: null,
          stickerMimeType: null,
          direction: 'outgoing',
        }),
      ],
      sequence('keep'),
    )

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-sticker',
    ])
    expect(
      useMessageStore.getState().messagesById['local-sticker'],
    ).toMatchObject({
      text: '',
      stickerUrl: 'https://media.example/sticker.png',
      stickerMimeType: 'image/png',
      direction: 'outgoing',
    })
  })
})

function draft(
  patch: Partial<HistoryMessageDraft> & { providerId: string },
): HistoryMessageDraft {
  return {
    chatId: '10000000',
    text: 'текст',
    stickerUrl: null,
    stickerMimeType: null,
    direction: 'outgoing',
    createdAt: 1,
    sentAt: null,
    sendState: 'sent',
    ...patch,
  }
}

function sequence(prefix: string): () => string {
  let index = 0
  return () => {
    index += 1
    return `${prefix}-${String(index)}`
  }
}
