import { unsupportedMessageText } from './message-copy.ts'
import type {
  Message,
  MessageDirection,
  MessageQuote,
  MessageState,
} from './message.types.ts'

export const unavailableQuoteText = 'Исходное сообщение недоступно'

export const unloadedQuoteNotice = 'Исходное сообщение не загружено'

const mediaQuoteLabels: Record<string, string> = {
  imageMessage: 'Изображение',
  videoMessage: 'Видео',
  documentMessage: 'Документ',
  audioMessage: 'Аудио',
  stickerMessage: 'Стикер',
  reactionMessage: 'Реакция',
  locationMessage: 'Геолокация',
  pollMessage: 'Опрос',
}

export type QuotePresentation = {
  author: string | null
  excerpt: string
}

export function mediaQuoteLabel(typeMessage: string | null): string | null {
  if (typeMessage === null) {
    return null
  }

  return mediaQuoteLabels[typeMessage] ?? null
}

export function presentQuote(input: {
  quote: MessageQuote
  original: {
    direction: MessageDirection
    text: string
    stickerUrl: string | null
  } | null
  contactTitle: string | null
  selfName: string | null
}): QuotePresentation {
  if (input.original !== null) {
    const author =
      input.original.direction === 'outgoing'
        ? (visible(input.selfName) ?? 'Вы')
        : visible(input.contactTitle)
    const excerpt = originalExcerpt(input.original, input.quote.typeMessage)
    if (author === null || excerpt === null) {
      return { author: null, excerpt: unavailableQuoteText }
    }

    return { author, excerpt }
  }

  const excerpt = apiExcerpt(input.quote)
  if (excerpt === null) {
    return { author: null, excerpt: unavailableQuoteText }
  }

  return { author: visible(input.quote.authorName), excerpt }
}

export function quoteOriginal(
  state: MessageState,
  message: Message | undefined,
): Message | null {
  const quote = message?.quote ?? null
  if (message === undefined || quote === null) {
    return null
  }

  const localId = state.localIdByProviderId[quote.sourceId]
  if (localId === undefined) {
    return null
  }

  const found = state.messagesById[localId]
  if (found === undefined || found.chatId !== message.chatId) {
    return null
  }

  return found
}

function originalExcerpt(
  original: { text: string; stickerUrl: string | null },
  typeMessage: string | null,
): string | null {
  if (original.stickerUrl !== null) {
    return mediaQuoteLabel('stickerMessage')
  }

  if (original.text !== '' && original.text !== unsupportedMessageText) {
    return original.text
  }

  return mediaQuoteLabel(typeMessage)
}

function apiExcerpt(quote: MessageQuote): string | null {
  const excerpt = visible(quote.excerpt)
  if (excerpt !== null) {
    return excerpt
  }

  return mediaQuoteLabel(quote.typeMessage)
}

function visible(value: string | null): string | null {
  if (value === null) {
    return null
  }

  return value.trim() === '' ? null : value
}
