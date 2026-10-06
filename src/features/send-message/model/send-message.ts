import {
  classifyTariffLimit,
  createGreenApiClient,
  GreenApiError,
} from '@/shared/api'
import type { GreenApiClient, TariffLimitKind } from '@/shared/api'
import { recordChatActivity, useChatStore } from '@/entities/chat'
import {
  addMessage,
  selfAuthorName,
  updateMessage,
  useMessageStore,
  type MessageQuote,
  type ReplySelection,
} from '@/entities/message'
import { sessionIdentity, useSessionStore } from '@/entities/session'
import { clearToasts, showToast } from '@/shared/lib/toast'

import { clearDraft, selectReply, useDraftStore } from './drafts.ts'
import { messageTextIssue, messageTextMessage } from './message-text.ts'

export const unknownSendMessage =
  'Результат отправки неизвестен. Сообщение могло уйти в очередь.'

export const chatQuotaMessage = 'Превышена квота чатов тарифа.'

export const methodQuotaMessage = 'Превышена квота метода отправки.'

export const bothQuotaMessage = 'Превышена квота чатов и метода отправки.'

export const tariffLimitMessage = 'Сработало ограничение тарифа.'

const sendRefusedMessage = 'Сообщение не отправлено.'
const sendNotAcceptedMessage = 'Сообщение не принято.'
const sendRestrictedMessage = 'Отправка ограничена для этого аккаунта.'
const sendRateLimitMessage = 'Слишком много запросов. Повторите позже.'
const deliveryFailedMessage = 'Сообщение не доставлено.'
const noAccountMessage = 'На номере получателя нет аккаунта MAX.'
const notInGroupMessage = 'Отправитель не участник группового чата.'

export type SendTextOutcome =
  | { status: 'invalid'; message: string }
  | { status: 'accepted'; localId: string }
  | { status: 'ignored' }

export type RetryOutcome =
  | { status: 'confirm' }
  | { status: 'blocked' }
  | { status: 'accepted'; localId: string }
  | { status: 'ignored' }

type SendClient = Pick<GreenApiClient, 'sendMessage'>

type SendOptions = {
  client?: SendClient
  now?: () => number
  createId?: () => string
}

type SendAttempt = {
  key: string
  announced: boolean
}

let sendGeneration = 0
let flightSerial = 0
let attemptSerial = 0
const flightTokens = new Map<string, number>()
const controllers = new Set<AbortController>()
const attempts = new Map<string, SendAttempt>()

export function cancelOutgoingMessages(): void {
  sendGeneration += 1
  flightTokens.clear()
  attempts.clear()
  clearToasts()
  for (const controller of controllers) {
    controller.abort()
  }
  controllers.clear()
}

function beginFlight(chatId: string): number {
  flightSerial += 1
  flightTokens.set(chatId, flightSerial)
  return flightSerial
}

function endFlight(chatId: string, token: number): void {
  if (flightTokens.get(chatId) === token) {
    flightTokens.delete(chatId)
  }
}

export async function sendChatMessage(
  chatId: string,
  text: string,
  options: SendOptions = {},
): Promise<SendTextOutcome> {
  const issue = messageTextIssue(text)
  if (issue !== null) {
    return { status: 'invalid', message: messageTextMessage(issue) }
  }

  const connection = useSessionStore.getState().connection
  if (connection === null) {
    return { status: 'invalid', message: 'Подключение не найдено.' }
  }

  const chat = useChatStore.getState().chatsById[chatId]
  if (chat === undefined) {
    return { status: 'invalid', message: 'Чат не выбран.' }
  }

  if (flightTokens.has(chat.chatId)) {
    return { status: 'ignored' }
  }

  const reply = selectReply(chat.chatId)(useDraftStore.getState())
  if (
    reply !== null &&
    (reply.chatId !== chat.chatId || reply.providerId.trim() === '')
  ) {
    return { status: 'invalid', message: 'Нельзя ответить на это сообщение.' }
  }

  const quote = replyToQuote(reply)
  const localId = options.createId?.() ?? crypto.randomUUID()
  const generation = sendGeneration
  const sessionKey = sessionIdentity(connection)
  const createdAt = options.now?.() ?? Date.now()
  const flight = beginFlight(chat.chatId)
  addMessage({
    localId,
    providerId: null,
    chatId: chat.chatId,
    text,
    stickerUrl: null,
    stickerMimeType: null,
    direction: 'outgoing',
    createdAt,
    sentAt: createdAt,
    sendState: 'sending',
    errorText: null,
    quote,
    originName: selfAuthorName,
  })
  recordChatActivity(chat.chatId, {
    preview: text,
    at: createdAt,
  })
  clearDraft(chat.chatId)

  try {
    await deliver({
      localId,
      chatId: chat.chatId,
      text,
      quotedMessageId: quote?.sourceId,
      sessionKey,
      generation,
      client: options.client,
    })
    return { status: 'accepted', localId }
  } finally {
    endFlight(chat.chatId, flight)
  }
}

export async function retryChatMessage(
  localId: string,
  acknowledgeUnknown = false,
  options: SendOptions = {},
): Promise<RetryOutcome> {
  const message = useMessageStore.getState().messagesById[localId]
  if (message === undefined || message.direction !== 'outgoing') {
    return { status: 'ignored' }
  }

  if (
    message.sendState === 'sending' ||
    message.sendState === 'queued' ||
    message.sendState === 'sent' ||
    message.sendState === 'delivered' ||
    message.sendState === 'read'
  ) {
    return { status: 'blocked' }
  }

  if (message.sendState === 'unknown' && !acknowledgeUnknown) {
    return { status: 'confirm' }
  }

  if (flightTokens.has(message.chatId)) {
    return { status: 'ignored' }
  }

  const connection = useSessionStore.getState().connection
  if (connection === null) {
    return { status: 'ignored' }
  }

  const quote = message.quote ?? null
  if (quote !== null && quote.sourceId.trim() === '') {
    return { status: 'ignored' }
  }

  const generation = sendGeneration
  const sessionKey = sessionIdentity(connection)
  const flight = beginFlight(message.chatId)
  updateMessage(localId, { sendState: 'sending', errorText: null })

  try {
    await deliver({
      localId,
      chatId: message.chatId,
      text: message.text,
      quotedMessageId: quote?.sourceId,
      sessionKey,
      generation,
      client: options.client,
    })
    return { status: 'accepted', localId }
  } finally {
    endFlight(message.chatId, flight)
  }
}

async function deliver(input: {
  localId: string
  chatId: string
  text: string
  quotedMessageId?: string
  sessionKey: string
  generation: number
  client?: SendClient
}): Promise<void> {
  const controller = new AbortController()
  controllers.add(controller)

  let attempt: SendAttempt | null = null

  try {
    const connection = useSessionStore.getState().connection
    if (
      connection === null ||
      sessionIdentity(connection) !== input.sessionKey ||
      input.generation !== sendGeneration
    ) {
      return
    }

    attempt = openAttempt(input.localId)
    const api = input.client ?? createGreenApiClient(connection)
    const result = await api.sendMessage(
      {
        chatId: input.chatId,
        message: input.text,
        ...(input.quotedMessageId === undefined
          ? {}
          : { quotedMessageId: input.quotedMessageId }),
      },
      { signal: controller.signal },
    )

    if (isStale(input.sessionKey, input.generation)) {
      dropAttempt(input.localId, attempt.key)
      return
    }

    if (result.idMessage.trim() === '') {
      settleAttempt(input.localId, attempt.key)
      markUnknown(input.localId)
      return
    }

    updateMessage(input.localId, {
      providerId: result.idMessage,
      sendState: 'queued',
      errorText: null,
    })
  } catch (error) {
    if (
      attempt === null ||
      isStale(input.sessionKey, input.generation) ||
      (error instanceof GreenApiError && error.kind === 'abort')
    ) {
      if (attempt !== null) {
        dropAttempt(input.localId, attempt.key)
      }
      return
    }

    applySendError(input.localId, attempt.key, error)
  } finally {
    controllers.delete(controller)
  }
}

function replyToQuote(reply: ReplySelection | null): MessageQuote | null {
  if (reply === null) {
    return null
  }

  return {
    sourceId: reply.providerId.trim(),
    excerpt: reply.excerpt,
    authorName: reply.bubbleAuthor,
    typeMessage: 'textMessage',
  }
}

function isStale(sessionKey: string, generation: number): boolean {
  if (generation !== sendGeneration) {
    return true
  }

  return sessionIdentity(useSessionStore.getState().connection) !== sessionKey
}

// После старта запроса таймаут, обрыв сети, HTTP 5xx и неверное
// тело становятся `unknown`: сообщение уже могло попасть в очередь.
// HTTP 400, 403 и 469, а также клиентский `invalid-request` до
// сетевого вызова — явный отказ (`failed`). HTTP 466 — лимит тарифа
// и тоже `failed`: квота чатов, квота метода или нераспознанный лимит.
// Это не ошибка номера телефона и не сетевая ошибка. SendMessage
// автоматически не повторяется.
function applySendError(
  localId: string,
  attemptKey: string,
  error: unknown,
): void {
  const current = useMessageStore.getState().messagesById[localId]
  if (current === undefined) {
    dropAttempt(localId, attemptKey)
    return
  }

  if (!(error instanceof GreenApiError)) {
    settleAttempt(localId, attemptKey)
    markUnknown(localId)
    return
  }

  if (error.kind === 'invalid-request') {
    failAttempt(localId, attemptKey, sendRefusedMessage)
    return
  }

  if (error.kind === 'http' && error.status === 466) {
    failAttempt(
      localId,
      attemptKey,
      tariffNotice(classifyTariffLimit(error.responseBody)),
    )
    return
  }

  if (error.kind === 'http' && isExplicitHttpRefusal(error.status)) {
    failAttempt(localId, attemptKey, httpRefusalText(error.status))
    return
  }

  settleAttempt(localId, attemptKey)
  markUnknown(localId)
}

export function reportOutgoingTextRefusal(input: {
  localId: string
  status: 'failed' | 'noAccount' | 'notInGroup'
}): void {
  const attempt = attempts.get(input.localId)
  if (attempt === undefined) {
    return
  }

  const message = useMessageStore.getState().messagesById[input.localId]
  if (
    message === undefined ||
    message.direction !== 'outgoing' ||
    message.stickerUrl !== null
  ) {
    return
  }

  if (!attempt.announced) {
    announceAttempt(
      input.localId,
      attempt.key,
      outgoingRefusalText(input.status),
    )
  }
  updateMessage(input.localId, { errorText: null })
}

function failAttempt(
  localId: string,
  attemptKey: string,
  notice: string,
): void {
  updateMessage(localId, { sendState: 'failed', errorText: null })
  announceAttempt(localId, attemptKey, notice)
}

function markUnknown(localId: string): void {
  const current = useMessageStore.getState().messagesById[localId]
  if (current === undefined) {
    return
  }

  updateMessage(localId, {
    sendState: 'unknown',
    errorText: null,
  })
}

function openAttempt(localId: string): SendAttempt {
  attemptSerial += 1
  const attempt = {
    key: `send:${localId}:${String(attemptSerial)}`,
    announced: false,
  }
  attempts.set(localId, attempt)
  return attempt
}

function dropAttempt(localId: string, attemptKey: string): void {
  if (attempts.get(localId)?.key === attemptKey) {
    attempts.delete(localId)
  }
}

function settleAttempt(localId: string, attemptKey: string): void {
  const attempt = attempts.get(localId)
  if (attempt?.key === attemptKey) {
    attempt.announced = true
  }
}

function announceAttempt(
  localId: string,
  attemptKey: string,
  notice: string,
): void {
  const attempt = attempts.get(localId)
  if (
    attempt === undefined ||
    attempt.key !== attemptKey ||
    attempt.announced
  ) {
    return
  }

  attempt.announced = true
  showToast({
    kind: 'error',
    message: notice,
    dedupeKey: attempt.key,
  })
}

function outgoingRefusalText(
  status: 'failed' | 'noAccount' | 'notInGroup',
): string {
  if (status === 'noAccount') {
    return noAccountMessage
  }
  if (status === 'notInGroup') {
    return notInGroupMessage
  }
  return deliveryFailedMessage
}

function tariffNotice(kind: TariffLimitKind): string {
  if (kind === 'chats') {
    return chatQuotaMessage
  }
  if (kind === 'method') {
    return methodQuotaMessage
  }
  if (kind === 'both') {
    return bothQuotaMessage
  }
  return tariffLimitMessage
}

function isExplicitHttpRefusal(status: number | null): boolean {
  return status === 400 || status === 403 || status === 469
}

function httpRefusalText(status: number | null): string {
  if (status === 403) {
    return sendRestrictedMessage
  }

  if (status === 469) {
    return sendRateLimitMessage
  }

  return sendNotAcceptedMessage
}
