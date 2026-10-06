export type MessageDirection = 'incoming' | 'outgoing'

export type OutgoingSendState =
  'sending' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown'

export type MessageQuote = {
  sourceId: string
  excerpt: string | null
  authorName: string | null
  typeMessage: string | null
}

export type ReplySelection = {
  providerId: string
  chatId: string
  composerLabel: string
  bubbleAuthor: string
  excerpt: string
}

export type HistoryMessageDraft = {
  providerId: string
  chatId: string
  text: string
  stickerUrl: string | null
  stickerMimeType: string | null
  direction: MessageDirection
  createdAt: number
  sentAt: number | null
  sendState: OutgoingSendState | null
  quote?: MessageQuote | null
  edited?: boolean
  forwarded?: boolean
  forwardingScore?: number | null
}

export type MessageReaction = {
  sourceId: string
  emoji: string
  eventAt: number | null
}

export type MessageReactionEvent = {
  chatId: string
  targetId: string | null
  sourceId: string
  emoji: string | null
  eventAt: number | null
}

export type MessageDeletion = {
  chatId: string
  targetId: string | null
  eventId: string
}

export type PendingMessageReaction = {
  chatId: string
  targetId: string
  sourceId: string
  emoji: string
  eventAt: number | null
}

export type MessageEdit = {
  chatId: string
  originalId: string | null
  eventId: string
  text: string | null
  eventAt: number | null
}

export type PendingMessageEdit = {
  chatId: string
  originalId: string
  text: string
  eventAt: number | null
}

export type Message = {
  localId: string
  providerId: string | null
  chatId: string
  text: string
  stickerUrl: string | null
  stickerMimeType: string | null
  direction: MessageDirection
  createdAt: number
  sentAt: number | null
  sendState: OutgoingSendState | null
  errorText: string | null
  quote?: MessageQuote | null
  edited?: boolean
  editEventAt?: number | null
  forwarded?: boolean
  forwardingScore?: number | null
  originName?: string | null
  reactions?: MessageReaction[]
}

export type MessageState = {
  messagesById: Record<string, Message>
  messageIdsByChatId: Record<string, string[]>
  localIdByProviderId: Record<string, string>
  historyStampByChatId: Record<string, number>
  pendingEdits: Record<string, PendingMessageEdit>
  pendingReactions: Record<string, PendingMessageReaction>
  deletedProviderIds: Record<string, true>
}
