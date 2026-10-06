import {
  noteUnseenIncoming,
  recordChatActivity,
  reliableContactName,
  rewindDisplayedPreview,
  upsertChat,
  useChatStore,
} from '@/entities/chat'
import {
  addMessage,
  applyMessageDeletion,
  applyMessageReaction,
  latestDisplayedActivity,
  messagePreview,
  nextOriginName,
  unsupportedMessageText,
  publishMessageEdit,
  quietJournalEvent,
  selfAuthorName,
  unixSecondsToMillis,
  updateMessage,
  useMessageStore,
  type MessageQuote,
} from '@/entities/message'
import { useSessionStore } from '@/entities/session'

import { publishOutgoingSendRefusal } from './outgoing-refusal.ts'
import type {
  DeletedMessageNotification,
  IncomingExtendedTextNotification,
  IncomingQuotedNotification,
  EditedMessageNotification,
  IncomingStickerNotification,
  IncomingTextNotification,
  MaxNotification,
  OutgoingMessageStatusNotification,
  OutgoingStickerNotification,
  OutgoingTextNotification,
  ReactionMessageNotification,
} from '@/shared/api'

type ApplyOptions = {
  createId?: () => string
}

export function applyNotification(
  body: MaxNotification,
  options: ApplyOptions = {},
): void {
  if ('recognized' in body) {
    return
  }

  if (isDeletedNotification(body)) {
    applyDeletion(body)
    return
  }

  if (isReactionNotification(body)) {
    applyReaction(body)
    return
  }

  if (isEditedNotification(body)) {
    const chat = useChatStore.getState()
    publishMessageEdit(
      {
        chatId: body.senderData.chatId,
        originalId: body.messageData.editedMessageData.stanzaId,
        eventId: body.idMessage,
        text: body.messageData.editedMessageData.textMessage,
        eventAt: unixSecondsToMillis(body.timestamp),
      },
      chat.chatsById[body.senderData.chatId]?.lastActivityAt ?? null,
      chat,
    )
    return
  }

  if (body.typeWebhook === 'outgoingMessageStatus') {
    applyOutgoingStatus(body)
    return
  }

  const createId = options.createId ?? (() => crypto.randomUUID())
  if (isOutgoingSticker(body)) {
    applyOutgoingSticker(body, createId)
    return
  }

  if (isOutgoingText(body)) {
    applyOutgoingText(body, createId)
    return
  }

  if (isIncomingSticker(body)) {
    applySticker(body, createId)
    return
  }

  applyIncoming(body, createId)
}

function isDeletedNotification(
  body: MaxNotification,
): body is DeletedMessageNotification {
  return (
    !('recognized' in body) &&
    'messageData' in body &&
    body.messageData.typeMessage === 'deletedMessage'
  )
}

function isReactionNotification(
  body: MaxNotification,
): body is ReactionMessageNotification {
  return (
    !('recognized' in body) &&
    'messageData' in body &&
    body.messageData.typeMessage === 'reactionMessage'
  )
}

function applyDeletion(body: DeletedMessageNotification): void {
  const chatId = body.senderData.chatId
  applyMessageDeletion({
    chatId,
    targetId: body.messageData.deletedMessageData.stanzaId,
    eventId: body.idMessage,
  })
  rewindDisplayedPreview(chatId, latestDisplayedActivity(chatId))
  const chat = useChatStore.getState()
  quietJournalEvent(
    chatId,
    unixSecondsToMillis(body.timestamp),
    body.idMessage,
    chat.chatsById[chatId]?.lastActivityAt ?? null,
    chat,
  )
}

function applyReaction(body: ReactionMessageNotification): void {
  const chatId = body.senderData.chatId
  applyMessageReaction({
    chatId,
    targetId: body.messageData.targetId,
    sourceId: body.idMessage,
    emoji: body.messageData.extendedTextMessageData.text,
    eventAt: unixSecondsToMillis(body.timestamp),
  })
  const chat = useChatStore.getState()
  quietJournalEvent(
    chatId,
    unixSecondsToMillis(body.timestamp),
    body.idMessage,
    chat.chatsById[chatId]?.lastActivityAt ?? null,
    chat,
  )
}

function isOutgoingSticker(
  body: MaxNotification,
): body is OutgoingStickerNotification {
  return (
    !('recognized' in body) &&
    (body.typeWebhook === 'outgoingMessageReceived' ||
      body.typeWebhook === 'outgoingAPIMessageReceived') &&
    'messageData' in body &&
    body.messageData.typeMessage === 'stickerMessage'
  )
}

function applyOutgoingSticker(
  body: OutgoingStickerNotification,
  createId: () => string,
): void {
  const forwarded = stickerForward(body.messageData.fileMessageData)
  const knownId = useMessageStore.getState().localIdByProviderId[body.idMessage]
  if (knownId !== undefined) {
    noteExistingForward(knownId, forwarded)
    fillKnownSticker(knownId, body.messageData.fileMessageData)
    return
  }
  if (!ensurePersonalChat(body)) {
    return
  }

  const createdAt = unixSecondsToMillis(body.timestamp)
  if (createdAt === null) {
    return
  }

  const text = body.messageData.fileMessageData.caption
  const stickerUrl = body.messageData.fileMessageData.downloadUrl
  addMessage({
    localId: createId(),
    providerId: body.idMessage,
    chatId: body.senderData.chatId,
    text,
    stickerUrl,
    stickerMimeType: body.messageData.fileMessageData.mimeType,
    direction: 'outgoing',
    createdAt,
    sentAt: createdAt,
    sendState: 'sent',
    errorText: null,
    ...forwardFields(forwarded),
    originName: forwarded.forwarded ? null : selfAuthorName,
  })
  recordChatActivity(body.senderData.chatId, {
    preview: messagePreview({ text, stickerUrl }),
    at: createdAt,
    forwarded: forwarded.forwarded,
  })
}

function isEditedNotification(
  body: MaxNotification,
): body is EditedMessageNotification {
  return (
    !('recognized' in body) &&
    'messageData' in body &&
    body.messageData.typeMessage === 'editedMessage'
  )
}

function isOutgoingText(
  body: MaxNotification,
): body is OutgoingTextNotification {
  return (
    !('recognized' in body) &&
    (body.typeWebhook === 'outgoingMessageReceived' ||
      body.typeWebhook === 'outgoingAPIMessageReceived')
  )
}

function applyOutgoingText(
  body: OutgoingTextNotification,
  createId: () => string,
): void {
  const text = outgoingText(body)
  if (text.trim() === '') {
    return
  }

  const chatId = body.senderData.chatId
  const quote = notificationQuote(body)
  const forwarded = textForward(body.messageData)
  const knownId = useMessageStore.getState().localIdByProviderId[body.idMessage]
  if (knownId !== undefined) {
    fillMissingQuote(knownId, quote)
    noteExistingForward(knownId, forwarded)
    return
  }

  if (
    body.typeWebhook === 'outgoingAPIMessageReceived' &&
    !forwarded.forwarded
  ) {
    const pendingId = pendingSendId(chatId, text)
    if (pendingId !== null) {
      updateMessage(pendingId, { providerId: body.idMessage })
      fillMissingQuote(pendingId, quote)
      return
    }
  }

  if (!ensurePersonalChat(body)) {
    return
  }

  const createdAt = unixSecondsToMillis(body.timestamp)
  if (createdAt === null) {
    return
  }

  addMessage({
    localId: createId(),
    providerId: body.idMessage,
    chatId,
    text,
    stickerUrl: null,
    stickerMimeType: null,
    direction: 'outgoing',
    createdAt,
    sentAt: createdAt,
    sendState: 'sent',
    errorText: null,
    quote,
    ...forwardFields(forwarded),
    originName: nextOriginName({
      current: null,
      forwarded: forwarded.forwarded,
      knownAuthor: forwarded.forwarded ? null : selfAuthorName,
    }),
  })
  recordChatActivity(chatId, {
    preview: text,
    at: createdAt,
    forwarded: forwarded.forwarded,
  })
}

function textForward(
  messageData:
    | OutgoingTextNotification['messageData']
    | IncomingTextNotification['messageData']
    | IncomingExtendedTextNotification['messageData']
    | IncomingQuotedNotification['messageData'],
): { forwarded: boolean; forwardingScore: number | null } {
  if (messageData.typeMessage === 'textMessage') {
    return {
      forwarded: messageData.textMessageData.isForwarded === true,
      forwardingScore: scoreOrNull(messageData.textMessageData.forwardingScore),
    }
  }

  if (messageData.typeMessage === 'extendedTextMessage') {
    return {
      forwarded: messageData.extendedTextMessageData.isForwarded === true,
      forwardingScore: scoreOrNull(
        messageData.extendedTextMessageData.forwardingScore,
      ),
    }
  }

  if (messageData.typeMessage === 'quotedMessage') {
    return {
      forwarded: messageData.extendedTextMessageData.isForwarded === true,
      forwardingScore: scoreOrNull(
        messageData.extendedTextMessageData.forwardingScore,
      ),
    }
  }

  return { forwarded: false, forwardingScore: null }
}

function scoreOrNull(value: number | undefined): number | null {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    return null
  }
  return value
}

function forwardFields(info: {
  forwarded: boolean
  forwardingScore: number | null
}): { forwarded?: true; forwardingScore?: number } {
  if (!info.forwarded) {
    return {}
  }
  return info.forwardingScore === null
    ? { forwarded: true }
    : { forwarded: true, forwardingScore: info.forwardingScore }
}

function noteExistingForward(
  localId: string,
  info: { forwarded: boolean; forwardingScore: number | null },
): void {
  if (!info.forwarded) {
    return
  }
  const current = useMessageStore.getState().messagesById[localId]
  if (current === undefined || current.forwarded === true) {
    return
  }
  updateMessage(localId, forwardFields(info))
  const next = useMessageStore.getState().messagesById[localId]
  if (next === undefined) {
    return
  }
  recordChatActivity(next.chatId, {
    preview: messagePreview(next),
    at: next.createdAt,
    forwarded: true,
  })
}

function contactAuthor(chatId: string, forwarded: boolean): string | null {
  if (forwarded) {
    return null
  }
  const chat = useChatStore.getState().chatsById[chatId]
  return chat === undefined ? null : reliableContactName(chat)
}

function outgoingText(body: OutgoingTextNotification): string {
  if (body.messageData.typeMessage === 'textMessage') {
    return body.messageData.textMessageData.textMessage
  }

  return body.messageData.extendedTextMessageData.text
}

function notificationQuote(
  body:
    | OutgoingTextNotification
    | IncomingTextNotification
    | IncomingExtendedTextNotification
    | IncomingQuotedNotification,
): MessageQuote | null {
  const quote = body.messageData.quote
  if (quote === undefined) {
    return null
  }

  return {
    sourceId: quote.sourceId,
    excerpt: quote.excerpt,
    authorName: null,
    typeMessage: quote.typeMessage,
  }
}

function fillMissingQuote(localId: string, quote: MessageQuote | null): void {
  if (quote === null) {
    return
  }

  const current = useMessageStore.getState().messagesById[localId]
  if (current === undefined || (current.quote ?? null) !== null) {
    return
  }

  updateMessage(localId, { quote })
}

function pendingSendId(chatId: string, text: string): string | null {
  const state = useMessageStore.getState()
  const ids = state.messageIdsByChatId[chatId] ?? []
  let matched: string | null = null
  for (const localId of ids) {
    const message = state.messagesById[localId]
    if (
      message !== undefined &&
      message.direction === 'outgoing' &&
      message.providerId === null &&
      message.sendState === 'sending' &&
      message.text === text
    ) {
      matched = localId
    }
  }

  return matched
}

function ensurePersonalChat(body: {
  senderData: OutgoingTextNotification['senderData']
}): boolean {
  const chatId = body.senderData.chatId
  if (useChatStore.getState().chatsById[chatId] !== undefined) {
    return true
  }

  if (body.senderData.chatType !== 'user') {
    return false
  }

  const phone = body.senderData.senderPhoneNumber
  upsertChat({
    chatId,
    phoneNumber: phone === null || phone === 0 ? null : String(phone),
    name: body.senderData.chatName,
    username: null,
  })
  return useChatStore.getState().chatsById[chatId] !== undefined
}

function isIncomingSticker(
  body:
    | IncomingTextNotification
    | IncomingExtendedTextNotification
    | IncomingQuotedNotification
    | IncomingStickerNotification,
): body is IncomingStickerNotification {
  return body.messageData.typeMessage === 'stickerMessage'
}

function applyOutgoingStatus(body: OutgoingMessageStatusNotification): void {
  const localId = useMessageStore.getState().localIdByProviderId[body.idMessage]
  if (localId === undefined) {
    return
  }

  const message = useMessageStore.getState().messagesById[localId]
  if (
    message === undefined ||
    message.direction !== 'outgoing' ||
    message.chatId !== body.chatId
  ) {
    return
  }

  if (body.status === 'delivered') {
    if (message.sendState === 'read' || message.sendState === 'failed') {
      return
    }
    updateMessage(localId, { sendState: 'delivered', errorText: null })
    return
  }

  if (body.status === 'read') {
    if (message.sendState === 'failed') {
      return
    }
    updateMessage(localId, { sendState: 'read', errorText: null })
    return
  }

  if (
    body.status === 'failed' ||
    body.status === 'noAccount' ||
    body.status === 'notInGroup'
  ) {
    updateMessage(localId, {
      sendState: 'failed',
      errorText: failureText(body.status, body.description),
    })
    publishOutgoingSendRefusal({ localId, status: body.status })
  }
}

function applyIncoming(
  body:
    | IncomingTextNotification
    | IncomingExtendedTextNotification
    | IncomingQuotedNotification,
  createId: () => string,
): void {
  const text = incomingText(body)
  if (text.trim() === '') {
    return
  }

  const quote = notificationQuote(body)
  const forwarded = textForward(body.messageData)
  const knownId = useMessageStore.getState().localIdByProviderId[body.idMessage]
  if (knownId !== undefined) {
    fillMissingQuote(knownId, quote)
    noteExistingForward(knownId, forwarded)
    return
  }

  const chatId = body.senderData.chatId
  if (useChatStore.getState().chatsById[chatId] === undefined) {
    return
  }

  const createdAt = unixSecondsToMillis(body.timestamp)
  if (createdAt === null) {
    return
  }

  addMessage({
    localId: createId(),
    providerId: body.idMessage,
    chatId,
    text,
    stickerUrl: null,
    stickerMimeType: null,
    direction: 'incoming',
    createdAt,
    sentAt: createdAt,
    sendState: null,
    errorText: null,
    quote,
    ...forwardFields(forwarded),
    originName: nextOriginName({
      current: null,
      forwarded: forwarded.forwarded,
      knownAuthor: contactAuthor(chatId, forwarded.forwarded),
    }),
  })
  noteUnseenIncoming(chatId, body.idMessage)
  recordChatActivity(chatId, {
    preview: text,
    at: createdAt,
    forwarded: forwarded.forwarded,
  })
}

function applySticker(
  body: IncomingStickerNotification,
  createId: () => string,
): void {
  const forwarded = stickerForward(body.messageData.fileMessageData)
  const knownId = useMessageStore.getState().localIdByProviderId[body.idMessage]
  if (knownId !== undefined) {
    noteExistingForward(knownId, forwarded)
    fillKnownSticker(knownId, body.messageData.fileMessageData)
    return
  }

  const chatId = body.senderData.chatId
  if (useChatStore.getState().chatsById[chatId] === undefined) {
    return
  }

  const text = body.messageData.fileMessageData.caption
  const stickerUrl = body.messageData.fileMessageData.downloadUrl
  const createdAt = unixSecondsToMillis(body.timestamp)
  if (createdAt === null) {
    return
  }

  addMessage({
    localId: createId(),
    providerId: body.idMessage,
    chatId,
    text,
    stickerUrl,
    stickerMimeType: body.messageData.fileMessageData.mimeType,
    direction: 'incoming',
    createdAt,
    sentAt: createdAt,
    sendState: null,
    errorText: null,
    ...forwardFields(forwarded),
  })
  noteUnseenIncoming(chatId, body.idMessage)
  recordChatActivity(chatId, {
    preview: messagePreview({ text, stickerUrl }),
    at: createdAt,
    forwarded: forwarded.forwarded,
  })
}

function fillKnownSticker(
  localId: string,
  file: {
    downloadUrl: string
    mimeType: string | null
    caption: string
  },
): void {
  const current = useMessageStore.getState().messagesById[localId]
  if (
    current === undefined ||
    current.stickerUrl !== null ||
    file.downloadUrl.trim() === ''
  ) {
    return
  }

  updateMessage(localId, {
    stickerUrl: file.downloadUrl,
    stickerMimeType: file.mimeType,
    text: current.text === unsupportedMessageText ? file.caption : current.text,
  })
  const next = useMessageStore.getState().messagesById[localId]
  if (next === undefined) {
    return
  }
  recordChatActivity(next.chatId, {
    preview: messagePreview(next),
    at: next.createdAt,
    forwarded: next.forwarded === true,
  })
}

function stickerForward(file: {
  isForwarded?: boolean
  forwardingScore?: number
}): { forwarded: boolean; forwardingScore: number | null } {
  return {
    forwarded: file.isForwarded === true,
    forwardingScore: scoreOrNull(file.forwardingScore),
  }
}

function incomingText(
  body:
    | IncomingTextNotification
    | IncomingExtendedTextNotification
    | IncomingQuotedNotification,
): string {
  if (body.messageData.typeMessage === 'textMessage') {
    return body.messageData.textMessageData.textMessage
  }

  return body.messageData.extendedTextMessageData.text
}

function failureText(status: string, description: string | undefined): string {
  const base =
    status === 'noAccount'
      ? 'На номере получателя нет аккаунта MAX.'
      : status === 'notInGroup'
        ? 'Отправитель не участник группового чата.'
        : 'Сообщение не доставлено на сервер MAX.'
  const extra = safeDescription(description)
  return extra === null ? base : `${base} ${extra}`
}

function safeDescription(description: string | undefined): string | null {
  if (description === undefined) {
    return null
  }

  const text = description.trim()
  const token = useSessionStore.getState().connection?.apiTokenInstance
  if (
    text === '' ||
    /https?:\/\//i.test(text) ||
    (token !== undefined && token !== '' && text.includes(token))
  ) {
    return null
  }

  return text
}
