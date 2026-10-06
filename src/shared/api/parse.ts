import {
  instanceStates,
  type ChatDirectoryEntry,
  type ChatHistoryEntry,
  type CheckAccountResult,
  type DeleteNotificationResult,
  type GetContactInfoResult,
  type GetStateInstanceResult,
  type InstanceState,
  type MaxNotification,
  type OutgoingMessageStatusNotification,
  type ProviderQuote,
  type EditMessageResult,
  type ReadChatResult,
  type ReceivedNotification,
  type SendMessageResult,
} from './dto.ts'
import { GreenApiError } from './errors.ts'

export function parseGetStateInstance(value: unknown): GetStateInstanceResult {
  const record = expectRecord(value, 'GetStateInstance')
  return { stateInstance: expectInstanceState(record.stateInstance) }
}

export function parseCheckAccount(value: unknown): CheckAccountResult {
  const record = expectRecord(value, 'CheckAccount')

  if (record.status === false) {
    return {
      status: false,
      reason: expectString(record.reason, 'CheckAccount reason'),
    }
  }

  return {
    exist: expectBoolean(record.exist, 'CheckAccount exist'),
    chatId: expectString(record.chatId, 'CheckAccount chatId'),
    fromCache: expectBoolean(record.fromCache, 'CheckAccount fromCache'),
  }
}

export function parseGetContactInfo(value: unknown): GetContactInfoResult {
  const record = expectRecord(value, 'GetContactInfo')
  const phoneNumber = expectNumber(
    record.phoneNumber,
    'GetContactInfo phoneNumber',
  )

  if (!Number.isSafeInteger(phoneNumber)) {
    throw invalid('GetContactInfo phoneNumber')
  }

  return {
    chatId: expectString(record.chatId, 'GetContactInfo chatId'),
    name: expectString(record.name, 'GetContactInfo name'),
    contactName: expectString(record.contactName, 'GetContactInfo contactName'),
    phoneNumber,
  }
}

export function parseForwardMessages(value: unknown): {
  messages: string[]
} {
  const record = expectRecord(value, 'ForwardMessages')
  if (!Array.isArray(record.messages)) {
    throw invalid('ForwardMessages messages')
  }

  return {
    messages: record.messages.map((item) =>
      expectString(item, 'ForwardMessages messages'),
    ),
  }
}

export function parseEditMessage(value: unknown): EditMessageResult {
  const record = expectRecord(value, 'EditMessage')
  return { idMessage: expectString(record.idMessage, 'EditMessage idMessage') }
}

export function parseSendMessage(value: unknown): SendMessageResult {
  const record = expectRecord(value, 'SendMessage')
  return { idMessage: expectString(record.idMessage, 'SendMessage idMessage') }
}

export function parseReadChat(value: unknown): ReadChatResult {
  const record = expectRecord(value, 'ReadChat')
  if (record.setRead !== true) {
    throw invalid('ReadChat')
  }

  return { setRead: true }
}

export function parseChatDirectory(value: unknown): ChatDirectoryEntry[] {
  if (!Array.isArray(value)) {
    throw invalid('GetChats')
  }

  return value.map((item) => {
    const record = expectRecord(item, 'GetChats chat')
    const phoneNumber = expectNumber(record.phoneNumber, 'GetChats phoneNumber')
    if (!Number.isSafeInteger(phoneNumber)) {
      throw invalid('GetChats phoneNumber')
    }

    const chatId = expectString(record.chatId, 'GetChats chatId')
    if (chatId.trim() === '') {
      throw invalid('GetChats chatId')
    }

    return {
      chatId,
      name: expectString(record.name, 'GetChats name'),
      type: expectString(record.type, 'GetChats type'),
      phoneNumber,
    }
  })
}

export function parseChatHistory(value: unknown): ChatHistoryEntry[] {
  if (!Array.isArray(value)) {
    throw invalid('GetChatHistory')
  }

  return value.map((item) => {
    const record = expectRecord(item, 'GetChatHistory message')
    const type = expectString(record.type, 'GetChatHistory type')
    if (type !== 'incoming' && type !== 'outgoing') {
      throw invalid('GetChatHistory type')
    }

    const idMessage = expectString(record.idMessage, 'GetChatHistory idMessage')
    if (idMessage.trim() === '') {
      throw invalid('GetChatHistory idMessage')
    }

    const timestamp = expectNumber(record.timestamp, 'GetChatHistory timestamp')
    if (!Number.isSafeInteger(timestamp)) {
      throw invalid('GetChatHistory timestamp')
    }

    const chatId = expectString(record.chatId, 'GetChatHistory chatId')
    if (chatId.trim() === '') {
      throw invalid('GetChatHistory chatId')
    }

    const typeMessage = expectString(
      record.typeMessage,
      'GetChatHistory typeMessage',
    ).trim()
    const sticker =
      typeMessage === 'stickerMessage' ? stickerFile(record) : null
    const editEvent = historyEditEventOrNull(record, typeMessage)

    return {
      type,
      idMessage,
      timestamp,
      chatId,
      typeMessage,
      text:
        editEvent?.text ??
        (sticker === null ? historyText(record) : captionText(record.caption)),
      statusMessage: historyStatus(record.statusMessage),
      stickerUrl: sticker?.url ?? null,
      stickerMimeType: sticker?.mimeType ?? null,
      quote: historyQuote(record),
      isEdited: record.isEdited === true,
      editedMessageId: quoteId(record.editedMessageId),
      editEvent,
      reaction: historyReaction(record, typeMessage),
      deletion: historyDeletion(record, typeMessage),
      deleted: record.isDeleted === true,
      deletedMessageId: quoteId(record.deletedMessageId),
      ...historyForward(record),
    }
  })
}

function historyForward(record: Record<string, unknown>): {
  forwarded: boolean
  forwardingScore: number | null
} {
  const data = isRecord(record.textMessageData)
    ? record.textMessageData
    : isRecord(record.extendedTextMessageData)
      ? record.extendedTextMessageData
      : isRecord(record.fileMessageData)
        ? record.fileMessageData
        : null
  const score = data?.forwardingScore ?? record.forwardingScore
  return {
    forwarded: data?.isForwarded === true || record.isForwarded === true,
    forwardingScore:
      typeof score === 'number' && Number.isSafeInteger(score) && score >= 0
        ? score
        : null,
  }
}

function historyEditEventOrNull(
  record: Record<string, unknown>,
  typeMessage: string,
): { originalId: string | null; text: string | null } | null {
  if (
    typeMessage === 'reactionMessage' ||
    typeMessage === 'deletedMessage' ||
    isRecord(record.deletedMessageData)
  ) {
    return null
  }
  if (typeMessage === 'editedMessage') {
    return historyEditEvent(record)
  }
  if (
    typeMessage === 'textMessage' ||
    typeMessage === 'extendedTextMessage' ||
    typeMessage === 'quotedMessage' ||
    typeMessage === 'stickerMessage' ||
    !isRecord(record.editedMessageData)
  ) {
    return null
  }

  return historyEditEvent(record)
}

function historyReaction(
  record: Record<string, unknown>,
  typeMessage: string,
): { targetId: string | null; emoji: string | null } | null {
  if (typeMessage !== 'reactionMessage') {
    return null
  }

  return {
    targetId: quoteObject(record.quotedMessage)?.sourceId ?? null,
    emoji: nestedText(record.extendedTextMessageData, 'text'),
  }
}

function historyDeletion(
  record: Record<string, unknown>,
  typeMessage: string,
): { targetId: string | null } | null {
  const data = isRecord(record.deletedMessageData)
    ? record.deletedMessageData
    : null
  if (typeMessage !== 'deletedMessage' && data === null) {
    return null
  }

  return {
    targetId:
      (data === null ? null : quoteId(data.stanzaId)) ??
      quoteId(record.deletedMessageId),
  }
}

function historyEditEvent(record: Record<string, unknown>): {
  originalId: string | null
  text: string | null
} {
  const data = isRecord(record.editedMessageData)
    ? record.editedMessageData
    : null
  const stanza = data === null ? null : quoteId(data.stanzaId)
  const text =
    data !== null && typeof data.textMessage === 'string'
      ? data.textMessage
      : typeof record.textMessage === 'string'
        ? record.textMessage
        : historyText(record)

  return {
    originalId: stanza ?? quoteId(record.editedMessageId),
    text,
  }
}

function stickerFile(
  record: Record<string, unknown>,
): { url: string; mimeType: string | null } | null {
  const url = httpsMediaUrl(record.downloadUrl)
  if (url === null) {
    return null
  }

  const mimeType = record.mimeType
  return {
    url,
    mimeType:
      typeof mimeType === 'string' && mimeType.trim() !== ''
        ? mimeType.trim()
        : null,
  }
}

function captionText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const text = value.trim()
  return text === '' ? null : value
}

function httpsMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const text = value.trim()
  if (text === '' || text.length > 2048) {
    return null
  }

  try {
    const url = new URL(text)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null
    }

    return url.href
  } catch {
    return null
  }
}

function historyText(record: Record<string, unknown>): string | null {
  if (typeof record.textMessage === 'string' && record.textMessage !== '') {
    return record.textMessage
  }

  const extendedText = nestedText(record.extendedTextMessage, 'text')
  if (extendedText !== null) {
    return extendedText
  }

  if (
    record.typeMessage === 'quotedMessage' ||
    record.typeMessage === 'extendedTextMessage'
  ) {
    return nestedText(record.extendedTextMessageData, 'text')
  }

  return null
}

function historyQuote(record: Record<string, unknown>): ProviderQuote | null {
  if (record.typeMessage === 'reactionMessage') {
    return null
  }

  const nested = quoteObject(record.quotedMessage)
  if (record.typeMessage === 'quotedMessage') {
    return mergeProviderQuotes(
      quoteFromExtended(record.extendedTextMessageData) ??
        quoteFromExtended(record.extendedTextMessage),
      nested,
    )
  }

  if (
    record.typeMessage === 'textMessage' ||
    record.typeMessage === 'extendedTextMessage'
  ) {
    return nested
  }

  return null
}

function mergeProviderQuotes(
  extended: ProviderQuote | null,
  nested: ProviderQuote | null,
): ProviderQuote | null {
  if (extended === null) {
    return nested
  }
  if (nested === null || nested.sourceId !== extended.sourceId) {
    return extended
  }

  return {
    sourceId: extended.sourceId,
    participant: extended.participant ?? nested.participant,
    typeMessage: nested.typeMessage,
    excerpt: nested.excerpt,
  }
}

function quoteObject(value: unknown): ProviderQuote | null {
  if (!isRecord(value)) {
    return null
  }

  const sourceId = quoteId(value.stanzaId)
  if (sourceId === null) {
    return null
  }

  return {
    sourceId,
    participant: optionalQuoteText(value.participant),
    typeMessage: optionalQuoteText(value.typeMessage),
    excerpt: quoteExcerpt(value),
  }
}

function quoteFromExtended(value: unknown): ProviderQuote | null {
  if (!isRecord(value)) {
    return null
  }

  const sourceId = quoteId(value.stanzaId)
  if (sourceId === null) {
    return null
  }

  return {
    sourceId,
    participant: optionalQuoteText(value.participant),
    typeMessage: null,
    excerpt: null,
  }
}

function quoteExcerpt(record: Record<string, unknown>): string | null {
  if (typeof record.textMessage === 'string' && record.textMessage !== '') {
    return record.textMessage
  }

  return (
    nestedText(record.extendedTextMessage, 'text') ??
    nestedText(record.extendedTextMessageData, 'text') ??
    nestedText(record.textMessageData, 'textMessage')
  )
}

function nestedText(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null
  }

  const text = value[key]
  return typeof text === 'string' && text !== '' ? text : null
}

function quoteId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const text = value.trim()
  return text === '' ? null : text
}

function optionalQuoteText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const text = value.trim()
  return text === '' ? null : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function historyStatus(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const status = expectString(value, 'GetChatHistory statusMessage')
  return status.trim() === '' ? null : status
}

export function parseDeleteNotification(
  value: unknown,
): DeleteNotificationResult {
  const record = expectRecord(value, 'DeleteNotification')
  return {
    result: expectBoolean(record.result, 'DeleteNotification result'),
    reason: expectString(record.reason, 'DeleteNotification reason'),
  }
}

export function parseReceivedNotification(
  value: unknown,
): ReceivedNotification {
  const record = expectRecord(value, 'ReceiveNotification')
  const receiptId = record.receiptId

  if (typeof receiptId !== 'number' || !Number.isSafeInteger(receiptId)) {
    throw invalid('ReceiveNotification receiptId')
  }

  return {
    receiptId,
    body: parseNotificationBody(record.body),
  }
}

function parseNotificationBody(value: unknown): MaxNotification {
  const record = expectRecord(value, 'ReceiveNotification body')
  const typeWebhook = expectString(
    record.typeWebhook,
    'notification typeWebhook',
  )

  if (typeWebhook === 'incomingMessageReceived') {
    return parseIncomingMessage(record)
  }

  if (
    typeWebhook === 'outgoingMessageReceived' ||
    typeWebhook === 'outgoingAPIMessageReceived'
  ) {
    return parseOutgoingMessage(record, typeWebhook)
  }

  if (typeWebhook === 'outgoingMessageStatus') {
    return parseOutgoingStatus(record)
  }

  return { recognized: false, typeWebhook }
}

function parseIncomingMessage(
  record: Record<string, unknown>,
): MaxNotification {
  const messageData = expectRecord(record.messageData, 'messageData')
  const typeMessage = expectString(
    messageData.typeMessage,
    'messageData typeMessage',
  )
  const base = {
    typeWebhook: 'incomingMessageReceived' as const,
    timestamp: expectNumber(record.timestamp, 'notification timestamp'),
    idMessage: expectString(record.idMessage, 'notification idMessage'),
    senderData: {
      chatId: expectString(
        expectRecord(record.senderData, 'senderData').chatId,
        'senderData chatId',
      ),
    },
  }

  const edited = parseEditedMessage(messageData)
  if (typeMessage === 'editedMessage') {
    if (edited === null) {
      return { recognized: false, typeWebhook: 'incomingMessageReceived' }
    }

    return {
      ...base,
      messageData: {
        typeMessage: 'editedMessage',
        editedMessageData: edited,
      },
    }
  }

  if (typeMessage === 'textMessage') {
    const textData = expectRecord(
      messageData.textMessageData,
      'textMessageData',
    )
    return {
      ...base,
      messageData: {
        typeMessage: 'textMessage',
        textMessageData: {
          textMessage: expectString(textData.textMessage, 'textMessage'),
          ...optionalBoolean(textData, 'isForwarded'),
          ...optionalInteger(textData, 'forwardingScore'),
        },
        ...optionalQuote(messageData.quotedMessage),
      },
    }
  }

  if (typeMessage === 'quotedMessage') {
    const quoted = quotedMessageData(messageData)
    if (quoted === null) {
      return { recognized: false, typeWebhook: 'incomingMessageReceived' }
    }

    return {
      ...base,
      messageData: quoted,
    }
  }

  if (typeMessage === 'stickerMessage') {
    const file = expectRecord(messageData.fileMessageData, 'fileMessageData')
    const sticker = stickerFile(file)
    if (sticker === null) {
      return { recognized: false, typeWebhook: 'incomingMessageReceived' }
    }

    return {
      ...base,
      messageData: {
        typeMessage: 'stickerMessage',
        fileMessageData: {
          downloadUrl: sticker.url,
          mimeType: sticker.mimeType,
          caption: captionText(file.caption) ?? '',
          ...optionalBoolean(file, 'isForwarded'),
          ...optionalInteger(file, 'forwardingScore'),
        },
      },
    }
  }

  if (typeMessage === 'extendedTextMessage') {
    const textData = expectRecord(
      messageData.extendedTextMessageData,
      'extendedTextMessageData',
    )
    return {
      ...base,
      messageData: {
        typeMessage: 'extendedTextMessage',
        extendedTextMessageData: {
          text: expectString(textData.text, 'extended text'),
          ...optionalString(textData, 'description'),
          ...optionalString(textData, 'title'),
          ...optionalString(textData, 'jpegThumbnail'),
          ...optionalBoolean(textData, 'isForwarded'),
          ...optionalInteger(textData, 'forwardingScore'),
        },
        ...optionalQuote(messageData.quotedMessage),
      },
    }
  }

  if (typeMessage === 'deletedMessage') {
    return {
      ...base,
      messageData: {
        typeMessage: 'deletedMessage',
        deletedMessageData: {
          stanzaId: deletedStanzaId(messageData),
        },
      },
    }
  }

  if (typeMessage === 'reactionMessage') {
    return {
      ...base,
      messageData: reactionData(messageData),
    }
  }

  return { recognized: false, typeWebhook: 'incomingMessageReceived' }
}

function parseOutgoingMessage(
  record: Record<string, unknown>,
  typeWebhook: 'outgoingMessageReceived' | 'outgoingAPIMessageReceived',
): MaxNotification {
  const messageData = expectRecord(record.messageData, 'messageData')
  const typeMessage = expectString(
    messageData.typeMessage,
    'messageData typeMessage',
  )
  const sender = expectRecord(record.senderData, 'senderData')
  const chatId = expectString(sender.chatId, 'senderData chatId').trim()
  if (chatId === '') {
    throw invalid('senderData chatId')
  }

  const idMessage = expectString(
    record.idMessage,
    'notification idMessage',
  ).trim()
  if (idMessage === '') {
    throw invalid('notification idMessage')
  }

  const base = {
    typeWebhook,
    timestamp: expectNumber(record.timestamp, 'notification timestamp'),
    idMessage,
    senderData: {
      chatId,
      chatName: optionalName(sender.chatName),
      chatType: optionalName(sender.chatType),
      senderPhoneNumber: optionalPhone(sender.senderPhoneNumber),
    },
  }

  const edited = parseEditedMessage(messageData)
  if (typeMessage === 'editedMessage') {
    if (edited === null) {
      return { recognized: false, typeWebhook }
    }

    return {
      typeWebhook,
      timestamp: base.timestamp,
      idMessage: base.idMessage,
      senderData: { chatId: base.senderData.chatId },
      messageData: {
        typeMessage: 'editedMessage',
        editedMessageData: edited,
      },
    }
  }

  if (typeMessage === 'textMessage') {
    const textData = expectRecord(
      messageData.textMessageData,
      'textMessageData',
    )
    return {
      ...base,
      messageData: {
        typeMessage: 'textMessage',
        textMessageData: {
          textMessage: expectString(textData.textMessage, 'textMessage'),
          ...optionalBoolean(textData, 'isForwarded'),
          ...optionalInteger(textData, 'forwardingScore'),
        },
        ...optionalQuote(messageData.quotedMessage),
      },
    }
  }

  if (typeMessage === 'quotedMessage') {
    const quoted = quotedMessageData(messageData)
    if (quoted === null) {
      return { recognized: false, typeWebhook }
    }

    return {
      ...base,
      messageData: quoted,
    }
  }

  if (typeMessage === 'extendedTextMessage') {
    const textData = expectRecord(
      messageData.extendedTextMessageData,
      'extendedTextMessageData',
    )
    return {
      ...base,
      messageData: {
        typeMessage: 'extendedTextMessage',
        extendedTextMessageData: {
          text: expectString(textData.text, 'extended text'),
          ...optionalBoolean(textData, 'isForwarded'),
          ...optionalInteger(textData, 'forwardingScore'),
        },
        ...optionalQuote(messageData.quotedMessage),
      },
    }
  }

  if (typeMessage === 'stickerMessage') {
    const file = expectRecord(messageData.fileMessageData, 'fileMessageData')
    const sticker = stickerFile(file)
    if (sticker === null) {
      return { recognized: false, typeWebhook }
    }

    return {
      ...base,
      messageData: {
        typeMessage: 'stickerMessage',
        fileMessageData: {
          downloadUrl: sticker.url,
          mimeType: sticker.mimeType,
          caption: captionText(file.caption) ?? '',
          ...optionalBoolean(file, 'isForwarded'),
          ...optionalInteger(file, 'forwardingScore'),
        },
      },
    }
  }

  if (typeMessage === 'deletedMessage') {
    return {
      typeWebhook,
      timestamp: base.timestamp,
      idMessage: base.idMessage,
      senderData: { chatId: base.senderData.chatId },
      messageData: {
        typeMessage: 'deletedMessage',
        deletedMessageData: {
          stanzaId: deletedStanzaId(messageData),
        },
      },
    }
  }

  if (typeMessage === 'reactionMessage') {
    return {
      typeWebhook,
      timestamp: base.timestamp,
      idMessage: base.idMessage,
      senderData: { chatId: base.senderData.chatId },
      messageData: reactionData(messageData),
    }
  }

  return { recognized: false, typeWebhook }
}

function deletedStanzaId(messageData: Record<string, unknown>): string | null {
  const data = messageData.deletedMessageData
  if (!isRecord(data)) {
    return null
  }

  return quoteId(data.stanzaId)
}

function reactionData(messageData: Record<string, unknown>): {
  typeMessage: 'reactionMessage'
  extendedTextMessageData: { text: string | null }
  targetId: string | null
} {
  const textData = messageData.extendedTextMessageData
  return {
    typeMessage: 'reactionMessage',
    extendedTextMessageData: {
      text: isRecord(textData) ? nestedText(textData, 'text') : null,
    },
    targetId: quoteObject(messageData.quotedMessage)?.sourceId ?? null,
  }
}

function parseEditedMessage(messageData: Record<string, unknown>): {
  textMessage: string
  stanzaId: string | null
} | null {
  const data = messageData.editedMessageData
  if (!isRecord(data) || typeof data.textMessage !== 'string') {
    return null
  }

  return {
    textMessage: data.textMessage,
    stanzaId: quoteId(data.stanzaId),
  }
}

function quotedMessageData(messageData: Record<string, unknown>): {
  typeMessage: 'quotedMessage'
  extendedTextMessageData: {
    text: string
    stanzaId: string
    participant: string
    isForwarded?: boolean
    forwardingScore?: number
  }
  quote: ProviderQuote
} | null {
  const textData = messageData.extendedTextMessageData
  if (!isRecord(textData)) {
    return null
  }

  const text = textData.text
  const stanzaId = quoteId(textData.stanzaId)
  const participant = textData.participant
  if (
    typeof text !== 'string' ||
    stanzaId === null ||
    typeof participant !== 'string'
  ) {
    return null
  }

  const extended = quoteFromExtended(textData)
  const nested = quoteObject(messageData.quotedMessage)
  const quote = mergeProviderQuotes(extended, nested)
  if (quote === null) {
    return null
  }

  return {
    typeMessage: 'quotedMessage',
    extendedTextMessageData: {
      text,
      stanzaId,
      participant,
      ...optionalBoolean(textData, 'isForwarded'),
      ...optionalInteger(textData, 'forwardingScore'),
    },
    quote,
  }
}

function optionalQuote(
  value: unknown,
): { quote: ProviderQuote } | Record<string, never> {
  const quote = quoteObject(value)
  return quote === null ? {} : { quote }
}

function optionalName(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const text = expectString(value, 'senderData name').trim()
  return text === '' ? null : text
}

function optionalPhone(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null
  }

  const phone = expectNumber(value, 'senderData senderPhoneNumber')
  if (!Number.isSafeInteger(phone) || phone === 0) {
    return null
  }

  return phone
}

function parseOutgoingStatus(
  record: Record<string, unknown>,
): OutgoingMessageStatusNotification {
  return {
    typeWebhook: 'outgoingMessageStatus',
    timestamp: expectNumber(record.timestamp, 'notification timestamp'),
    idMessage: expectString(record.idMessage, 'notification idMessage'),
    chatId: expectString(record.chatId, 'notification chatId'),
    status: expectString(record.status, 'notification status'),
    ...optionalString(record, 'description'),
  }
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): Record<string, string> | Record<string, never> {
  if (!(key in record) || record[key] === undefined) {
    return {}
  }
  return { [key]: expectString(record[key], key) }
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
): Record<string, boolean> | Record<string, never> {
  if (!(key in record) || record[key] === undefined) {
    return {}
  }
  return { [key]: expectBoolean(record[key], key) }
}

function optionalInteger(
  record: Record<string, unknown>,
  key: string,
): Record<string, number> | Record<string, never> {
  if (!(key in record) || record[key] === undefined) {
    return {}
  }
  const value = record[key]
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalid(key)
  }
  return { [key]: value }
}

function expectInstanceState(value: unknown): InstanceState {
  if (isInstanceState(value)) {
    return value
  }
  throw invalid('GetStateInstance stateInstance')
}

function isInstanceState(value: unknown): value is InstanceState {
  return instanceStates.some((state) => state === value)
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw invalid(label)
}

function expectString(value: unknown, label: string): string {
  if (typeof value === 'string') {
    return value
  }
  throw invalid(label)
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  throw invalid(label)
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  throw invalid(label)
}

function invalid(label: string): GreenApiError {
  return new GreenApiError('invalid-response', `Invalid ${label}`)
}
