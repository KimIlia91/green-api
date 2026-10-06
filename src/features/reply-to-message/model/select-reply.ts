import { unsupportedMessageText } from '@/entities/message'
import type { MessageDirection, ReplySelection } from '@/entities/message'

export function replySelectionFor(input: {
  message: {
    providerId: string | null
    chatId: string
    text: string
    stickerUrl: string | null
    direction: MessageDirection
  }
  activeChatId: string
  contactTitle: string
  selfName: string | null
}): ReplySelection | null {
  if (input.message.chatId !== input.activeChatId) {
    return null
  }

  const providerId = input.message.providerId?.trim() ?? ''
  if (providerId === '') {
    return null
  }

  if (input.message.stickerUrl !== null) {
    return null
  }

  if (
    input.message.text === '' ||
    input.message.text === unsupportedMessageText
  ) {
    return null
  }

  const contactTitle = input.contactTitle.trim()
  const outgoing = input.message.direction === 'outgoing'
  if (
    !outgoing &&
    (contactTitle === '' || contactTitle === input.message.chatId)
  ) {
    return null
  }

  const selfName = visible(input.selfName)

  return {
    providerId,
    chatId: input.message.chatId,
    composerLabel: outgoing
      ? selfName === null
        ? 'Ответ для вас'
        : `Ответ для ${selfName}`
      : `Ответ для ${contactTitle}`,
    bubbleAuthor: outgoing ? (selfName ?? 'Вы') : contactTitle,
    excerpt: input.message.text,
  }
}

function visible(value: string | null): string | null {
  if (value === null) {
    return null
  }

  const text = value.trim()
  return text === '' ? null : text
}
