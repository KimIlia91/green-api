import { reliableContactName, useChatStore } from '@/entities/chat'
import {
  hasSelectableText,
  rememberMessageOrigin,
  selfAuthorName,
  useMessageStore,
  type Message,
} from '@/entities/message'
import { sessionIdentity, useSessionStore } from '@/entities/session'
import {
  classifyTariffLimit,
  createGreenApiClient,
  GreenApiError,
} from '@/shared/api'
import type { GreenApiClient, TariffLimitKind } from '@/shared/api'
import { showToast } from '@/shared/lib/toast'

export const unknownForwardMessage =
  'Сообщения могли быть пересланы. Повтор может создать дубль'

export const forwardUnconfirmedMessage = 'Не удалось подтвердить пересылку'

const forwardRefusedMessage = 'Не удалось переслать сообщения'

const forwardChatQuotaMessage = 'Превышена квота чатов тарифа.'

const forwardMethodQuotaMessage = 'Превышена квота метода пересылки.'

const forwardBothQuotaMessage = 'Превышена квота чатов и метода пересылки.'

const forwardTariffLimitMessage = 'Сработало ограничение тарифа.'

export type ForwardOutcome =
  | { status: 'queued' }
  | { status: 'rejected'; message: string }
  | { status: 'unknown'; message: string }
  | { status: 'confirm'; message: string }
  | { status: 'blocked'; message: string }
  | { status: 'ignored' }

export type ForwardFollowUp = {
  closeTarget: boolean
  clearSelection: boolean
  notice: string
  confirm: string | null
}

type ForwardClient = Pick<GreenApiClient, 'forwardMessages'>

type ForwardOptions = {
  client?: ForwardClient
  acknowledgeUnknown?: boolean
}

type ForwardProblem =
  | { kind: 'refused'; message: string }
  | { kind: 'uncertain' }
  | { kind: 'abort' }

type UnknownForward = {
  sessionKey: string
  targetChatId: string
  sourceKey: string
}

let generation = 0
let attemptSerial = 0
let unknownForward: UnknownForward | null = null
const controllers = new Set<AbortController>()

export function cancelPendingForwards(): void {
  generation += 1
  unknownForward = null
  for (const controller of controllers) {
    controller.abort()
  }
  controllers.clear()
}

export function forwardFollowUp(outcome: ForwardOutcome): ForwardFollowUp {
  if (outcome.status === 'queued') {
    return {
      closeTarget: true,
      clearSelection: true,
      notice: '',
      confirm: null,
    }
  }

  if (outcome.status === 'blocked') {
    return {
      closeTarget: true,
      clearSelection: false,
      notice: outcome.message,
      confirm: null,
    }
  }

  if (outcome.status === 'unknown' || outcome.status === 'confirm') {
    return {
      closeTarget: false,
      clearSelection: false,
      notice: '',
      confirm: outcome.message,
    }
  }

  return {
    closeTarget: false,
    clearSelection: false,
    notice: '',
    confirm: null,
  }
}

export function forwardBlockReason(
  messages: readonly Message[],
): string | null {
  if (messages.length === 0) {
    return null
  }

  const parts: string[] = []
  if (messages.some((message) => !hasSelectableText(message))) {
    parts.push('этот тип сообщения не пересылается')
  }
  if (messages.some((message) => (message.providerId?.trim() ?? '') === '')) {
    parts.push('нет подтверждённого идентификатора')
  }

  if (parts.length === 0) {
    return null
  }

  return `Пересылка недоступна: ${parts.join('; ')}.`
}

export async function forwardSelectedMessages(
  localIds: readonly string[],
  chatIdTo: string,
  options: ForwardOptions = {},
): Promise<ForwardOutcome> {
  const messages = localIds.flatMap((localId) => {
    const message = useMessageStore.getState().messagesById[localId]
    return message === undefined ? [] : [message]
  })
  const blocked = forwardBlockReason(messages)
  if (blocked !== null || messages.length === 0 || chatIdTo.trim() === '') {
    return {
      status: 'blocked',
      message: blocked ?? 'Пересылка недоступна.',
    }
  }

  const chatIdFrom = messages[0]?.chatId ?? ''
  if (messages.some((message) => message.chatId !== chatIdFrom)) {
    return { status: 'blocked', message: 'Пересылка недоступна.' }
  }

  const connection = useSessionStore.getState().connection
  if (connection === null) {
    return { status: 'blocked', message: 'Пересылка недоступна.' }
  }

  const sessionKey = sessionIdentity(connection)
  const sourceKey = messages.map((message) => message.localId).join('\0')
  if (
    isPendingUnknown(sessionKey, chatIdTo, sourceKey) &&
    options.acknowledgeUnknown !== true
  ) {
    return { status: 'confirm', message: unknownForwardMessage }
  }

  rememberSourceAuthors(messages)
  const client = options.client ?? createGreenApiClient(connection)
  const flight = currentGeneration()
  const attemptKey = `forward:${String((attemptSerial += 1))}`
  const controller = new AbortController()
  controllers.add(controller)
  unknownForward = null

  try {
    await client.forwardMessages(
      {
        chatId: chatIdTo,
        chatIdFrom,
        messages: messages.map((message) => message.providerId ?? ''),
      },
      { signal: controller.signal },
    )
  } catch (error) {
    if (isStale(flight, sessionKey) || isAbort(error)) {
      return { status: 'ignored' }
    }

    const problem = classifyForwardError(error)
    if (problem.kind === 'abort') {
      return { status: 'ignored' }
    }

    if (problem.kind === 'uncertain') {
      unknownForward = { sessionKey, targetChatId: chatIdTo, sourceKey }
      showToast({
        kind: 'error',
        message: forwardUnconfirmedMessage,
        dedupeKey: attemptKey,
      })
      return { status: 'unknown', message: unknownForwardMessage }
    }

    showToast({
      kind: 'error',
      message: problem.message,
      dedupeKey: attemptKey,
    })
    return { status: 'rejected', message: '' }
  } finally {
    controllers.delete(controller)
  }

  if (isStale(flight, sessionKey)) {
    return { status: 'ignored' }
  }

  return { status: 'queued' }
}

function currentGeneration(): number {
  return generation
}

function isPendingUnknown(
  sessionKey: string,
  targetChatId: string,
  sourceKey: string,
): boolean {
  return (
    unknownForward !== null &&
    unknownForward.sessionKey === sessionKey &&
    unknownForward.targetChatId === targetChatId &&
    unknownForward.sourceKey === sourceKey
  )
}

function isStale(flight: number, sessionKey: string): boolean {
  return (
    flight !== generation ||
    sessionIdentity(useSessionStore.getState().connection) !== sessionKey
  )
}

function isAbort(error: unknown): boolean {
  return error instanceof GreenApiError && error.kind === 'abort'
}

function classifyForwardError(error: unknown): ForwardProblem {
  if (!(error instanceof GreenApiError)) {
    return { kind: 'uncertain' }
  }

  if (error.kind === 'abort') {
    return { kind: 'abort' }
  }

  if (
    error.kind === 'timeout' ||
    error.kind === 'network' ||
    error.kind === 'invalid-response' ||
    error.kind === 'invalid-connection'
  ) {
    return { kind: 'uncertain' }
  }

  if (error.kind === 'invalid-request') {
    return { kind: 'refused', message: forwardRefusedMessage }
  }

  if (error.kind === 'http' && error.status === 466) {
    return {
      kind: 'refused',
      message: forwardTariffNotice(classifyTariffLimit(error.responseBody)),
    }
  }

  if (
    error.kind === 'http' &&
    (error.status === 400 || error.status === 403 || error.status === 469)
  ) {
    return { kind: 'refused', message: forwardRefusedMessage }
  }

  return { kind: 'uncertain' }
}

function forwardTariffNotice(kind: TariffLimitKind): string {
  if (kind === 'chats') {
    return forwardChatQuotaMessage
  }
  if (kind === 'method') {
    return forwardMethodQuotaMessage
  }
  if (kind === 'both') {
    return forwardBothQuotaMessage
  }
  return forwardTariffLimitMessage
}

function rememberSourceAuthors(messages: readonly Message[]): void {
  for (const message of messages) {
    if (message.forwarded === true) {
      continue
    }
    const chat = useChatStore.getState().chatsById[message.chatId]
    const author =
      message.direction === 'outgoing'
        ? selfAuthorName
        : chat === undefined
          ? null
          : reliableContactName(chat)
    if (author !== null) {
      rememberMessageOrigin(message.localId, author)
    }
  }
}
