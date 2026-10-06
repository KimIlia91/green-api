import { describe, expect, it } from 'vitest'

import { unsupportedMessageText } from '@/entities/message'

import { replySelectionFor } from '@/features/reply-to-message/model/select-reply.ts'

const message = {
  providerId: '116413118178426437',
  chatId: '10000000',
  text: 'исходный текст',
  stickerUrl: null,
  direction: 'incoming' as const,
}

describe('replySelectionFor', () => {
  it('quotes an incoming message by the contact title', () => {
    expect(
      replySelectionFor({
        message,
        activeChatId: '10000000',
        contactTitle: 'Анна',
        selfName: null,
      }),
    ).toEqual({
      providerId: '116413118178426437',
      chatId: '10000000',
      composerLabel: 'Ответ для Анна',
      bubbleAuthor: 'Анна',
      excerpt: 'исходный текст',
    })
  })

  it('uses the known self name, otherwise addresses you', () => {
    expect(
      replySelectionFor({
        message: { ...message, direction: 'outgoing' },
        activeChatId: '10000000',
        contactTitle: 'Анна',
        selfName: 'Илья',
      })?.composerLabel,
    ).toBe('Ответ для Илья')

    expect(
      replySelectionFor({
        message: { ...message, direction: 'outgoing' },
        activeChatId: '10000000',
        contactTitle: 'Анна',
        selfName: null,
      }),
    ).toMatchObject({
      composerLabel: 'Ответ для вас',
      bubbleAuthor: 'Вы',
    })
  })

  it('refuses a message without a provider id, another chat, or non-text', () => {
    expect(
      replySelectionFor({
        message: { ...message, providerId: null },
        activeChatId: '10000000',
        contactTitle: 'Анна',
        selfName: null,
      }),
    ).toBeNull()
    expect(
      replySelectionFor({
        message,
        activeChatId: '20000000',
        contactTitle: 'Анна',
        selfName: null,
      }),
    ).toBeNull()
    expect(
      replySelectionFor({
        message: { ...message, text: unsupportedMessageText },
        activeChatId: '10000000',
        contactTitle: 'Анна',
        selfName: null,
      }),
    ).toBeNull()
    expect(
      replySelectionFor({
        message,
        activeChatId: '10000000',
        contactTitle: '10000000',
        selfName: null,
      }),
    ).toBeNull()
  })
})
