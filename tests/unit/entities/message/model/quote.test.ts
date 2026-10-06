import { describe, expect, it } from 'vitest'

import {
  unavailableQuoteText,
  presentQuote,
} from '@/entities/message/model/quote.ts'
import type { MessageQuote } from '@/entities/message/model/message.types.ts'

const quote: MessageQuote = {
  sourceId: '116413118178426437',
  excerpt: 'исходный текст',
  authorName: null,
  typeMessage: 'textMessage',
}

describe('presentQuote', () => {
  it('uses the local author and text', () => {
    expect(
      presentQuote({
        quote,
        original: {
          direction: 'outgoing',
          text: 'своё сообщение',
          stickerUrl: null,
        },
        contactTitle: 'Анна',
        selfName: null,
      }),
    ).toEqual({ author: 'Вы', excerpt: 'своё сообщение' })

    expect(
      presentQuote({
        quote,
        original: {
          direction: 'incoming',
          text: 'привет',
          stickerUrl: null,
        },
        contactTitle: 'Анна',
        selfName: 'Илья',
      }),
    ).toEqual({ author: 'Анна', excerpt: 'привет' })
  })

  it('labels a non-text original without inventing a file', () => {
    expect(
      presentQuote({
        quote: { ...quote, typeMessage: 'stickerMessage', excerpt: null },
        original: { direction: 'incoming', text: '', stickerUrl: 'https://x' },
        contactTitle: 'Анна',
        selfName: null,
      }),
    ).toEqual({ author: 'Анна', excerpt: 'Стикер' })
  })

  it('uses the API excerpt when the original is not loaded', () => {
    expect(
      presentQuote({
        quote,
        original: null,
        contactTitle: 'Анна',
        selfName: null,
      }),
    ).toEqual({ author: null, excerpt: 'исходный текст' })
  })

  it('uses a neutral caption when the quote has neither text nor a known type', () => {
    expect(
      presentQuote({
        quote: { ...quote, excerpt: null, typeMessage: null },
        original: null,
        contactTitle: '10000000',
        selfName: null,
      }),
    ).toEqual({ author: null, excerpt: unavailableQuoteText })
  })

  it('does not treat a chat id as an author name', () => {
    expect(
      presentQuote({
        quote: { ...quote, authorName: null, excerpt: '  ' },
        original: {
          direction: 'incoming',
          text: '   ',
          stickerUrl: null,
        },
        contactTitle: '   ',
        selfName: null,
      }).author,
    ).toBeNull()
  })
})
