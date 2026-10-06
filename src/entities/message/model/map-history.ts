import type { ChatHistoryEntry } from '@/shared/api'

import { unsupportedMessageText } from './message-copy.ts'
import type {
  HistoryMessageDraft,
  MessageDeletion,
  MessageEdit,
  MessageQuote,
  MessageReactionEvent,
  OutgoingSendState,
} from './message.types.ts'

export function mapHistoryEntry(
  entry: ChatHistoryEntry,
): HistoryMessageDraft | null {
  if (
    entry.editEvent !== null ||
    entry.reaction != null ||
    entry.deletion != null ||
    entry.deleted === true
  ) {
    return null
  }

  const textual =
    entry.typeMessage === 'textMessage' ||
    entry.typeMessage === 'extendedTextMessage' ||
    entry.typeMessage === 'quotedMessage'
  const sentAt = unixSecondsToMillis(entry.timestamp)
  const stickerKnown = entry.stickerUrl !== null

  return {
    providerId: entry.idMessage,
    chatId: entry.chatId,
    text: stickerKnown
      ? (entry.text ?? '')
      : textual
        ? (entry.text ?? '')
        : unsupportedMessageText,
    stickerUrl: entry.stickerUrl,
    stickerMimeType: entry.stickerUrl === null ? null : entry.stickerMimeType,
    direction: entry.type,
    createdAt: sentAt ?? 0,
    sentAt,
    sendState:
      entry.type === 'outgoing' ? historySendState(entry.statusMessage) : null,
    quote: messageQuote(entry),
    ...(entry.isEdited ? { edited: true } : {}),
    ...(entry.forwarded ? { forwarded: true } : {}),
    ...(entry.forwardingScore !== null
      ? { forwardingScore: entry.forwardingScore }
      : {}),
  }
}

export function messageEditFromEntry(
  entry: ChatHistoryEntry,
): MessageEdit | null {
  if (entry.editEvent === null) {
    return null
  }

  return {
    chatId: entry.chatId,
    originalId: entry.editEvent.originalId,
    eventId: entry.idMessage,
    text: entry.editEvent.text,
    eventAt: unixSecondsToMillis(entry.timestamp),
  }
}

export function messageReactionFromEntry(
  entry: ChatHistoryEntry,
): MessageReactionEvent | null {
  if (entry.reaction == null) {
    return null
  }

  return {
    chatId: entry.chatId,
    targetId: entry.reaction.targetId,
    sourceId: entry.idMessage,
    emoji: entry.reaction.emoji,
    eventAt: unixSecondsToMillis(entry.timestamp),
  }
}

export function messageDeletionsFromEntry(
  entry: ChatHistoryEntry,
): MessageDeletion[] {
  const deletions: MessageDeletion[] = []
  if (entry.deletion != null) {
    deletions.push({
      chatId: entry.chatId,
      targetId: entry.deletion.targetId,
      eventId: entry.idMessage,
    })
  } else if (entry.deleted === true) {
    deletions.push({
      chatId: entry.chatId,
      targetId: entry.idMessage,
      eventId: entry.idMessage,
    })
  }

  const deletedMessageId = entry.deletedMessageId
  if (
    deletedMessageId != null &&
    deletedMessageId !== '' &&
    deletedMessageId !== entry.idMessage &&
    !deletions.some((deletion) => deletion.targetId === deletedMessageId)
  ) {
    deletions.push({
      chatId: entry.chatId,
      targetId: deletedMessageId,
      eventId: entry.idMessage,
    })
  }

  return deletions
}

function messageQuote(entry: ChatHistoryEntry): MessageQuote | null {
  if (entry.quote === null) {
    return null
  }

  return {
    sourceId: entry.quote.sourceId,
    excerpt: entry.quote.excerpt,
    authorName: null,
    typeMessage: entry.quote.typeMessage,
  }
}

function historySendState(status: string | null): OutgoingSendState | null {
  if (status === 'sent' || status === 'delivered' || status === 'read') {
    return status
  }

  return null
}

export function unixSecondsToMillis(timestamp: number): number | null {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    return null
  }

  const millis = timestamp * 1000
  if (!Number.isSafeInteger(millis)) {
    return null
  }

  return millis
}
