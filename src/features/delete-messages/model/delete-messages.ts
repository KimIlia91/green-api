import { rewindDisplayedPreview } from '@/entities/chat'
import {
  applyMessageDeletion,
  latestDisplayedActivity,
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

export const deleteUnconfirmedMessage = 'Не удалось подтвердить удаление.'

const deleteRefusedMessage = 'Не удалось удалить сообщение.'

const deleteChatQuotaMessage = 'Превышена квота чатов тарифа.'

const deleteMethodQuotaMessage = 'Превышена квота метода удаления.'

const deleteBothQuotaMessage = 'Превышена квота чатов и метода удаления.'

const deleteTariffLimitMessage = 'Сработало ограничение тарифа.'

export type DeleteMessagesOutcome = {
  deleted: string[]
  failed: string[]
  uncertain: string[]
  message: string
}

type DeleteClient = Pick<GreenApiClient, 'deleteMessage'>

type DeleteOptions = {
  client?: DeleteClient
}

type DeleteProblem =
  | { kind: 'refused'; quota: string | null }
  | { kind: 'uncertain' }
  | { kind: 'abort' }

let generation = 0
let attemptSerial = 0
const controllers = new Set<AbortController>()

export function cancelPendingDeletes(): void {
  generation += 1
  for (const controller of controllers) {
    controller.abort()
  }
  controllers.clear()
}

export function deleteConfirmLabel(count: number): string {
  return `Удалить ${String(count)} ${messageWord(count)}?`
}

function messageWord(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return 'сообщение'
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'сообщения'
  }
  return 'сообщений'
}

export function deleteBlockReason(messages: readonly Message[]): string | null {
  if (messages.length === 0) {
    return null
  }

  const parts: string[] = []
  if (messages.some((message) => message.direction !== 'outgoing')) {
    parts.push('API удаляет только свои сообщения')
  }
  if (messages.some((message) => (message.providerId?.trim() ?? '') === '')) {
    parts.push('нет подтверждённого идентификатора')
  }

  if (parts.length === 0) {
    return null
  }

  return `Удаление недоступно: ${parts.join('; ')}.`
}

export async function deleteMessages(
  localIds: readonly string[],
  options: DeleteOptions = {},
): Promise<DeleteMessagesOutcome> {
  const messages = localIds.flatMap((localId) => {
    const message = useMessageStore.getState().messagesById[localId]
    return message === undefined ? [] : [message]
  })
  const blocked = deleteBlockReason(messages)
  if (blocked !== null || messages.length === 0) {
    return {
      deleted: [],
      failed: localIds.slice(),
      uncertain: [],
      message: blocked ?? '',
    }
  }

  const connection = useSessionStore.getState().connection
  if (connection === null) {
    return { deleted: [], failed: localIds.slice(), uncertain: [], message: '' }
  }

  const client = options.client ?? createGreenApiClient(connection)
  const flight = currentGeneration()
  const sessionKey = sessionIdentity(connection)
  const attemptKey = `delete:${String((attemptSerial += 1))}`
  const controller = new AbortController()
  controllers.add(controller)
  const deleted: string[] = []
  const failed: string[] = []
  const uncertain: string[] = []
  let quotaNotice: string | null = null
  let singleRefusal: string | null = null
  let chatId = ''

  try {
    for (const message of messages) {
      if (isStale(flight, sessionKey)) {
        return { deleted, failed, uncertain, message: '' }
      }

      const providerId = message.providerId
      if (providerId === null) {
        failed.push(message.localId)
        singleRefusal = deleteRefusedMessage
        continue
      }

      chatId = message.chatId
      try {
        await client.deleteMessage(
          {
            chatId: message.chatId,
            idMessage: providerId,
            onlySenderDelete: false,
          },
          { signal: controller.signal },
        )
        if (isStale(flight, sessionKey)) {
          return { deleted, failed, uncertain, message: '' }
        }
        applyMessageDeletion({
          chatId: message.chatId,
          targetId: providerId,
          eventId: providerId,
        })
        deleted.push(message.localId)
      } catch (error) {
        if (isStale(flight, sessionKey) || isAbort(error)) {
          return { deleted, failed, uncertain, message: '' }
        }

        const problem = classifyDeleteError(error)
        if (problem.kind === 'uncertain') {
          uncertain.push(message.localId)
          continue
        }
        if (problem.kind === 'abort') {
          return { deleted, failed, uncertain, message: '' }
        }

        failed.push(message.localId)
        singleRefusal = problem.quota ?? deleteRefusedMessage
        if (problem.quota !== null) {
          quotaNotice = problem.quota
          break
        }
      }
    }
  } finally {
    controllers.delete(controller)
  }

  if (isStale(flight, sessionKey)) {
    return { deleted, failed, uncertain, message: '' }
  }

  if (chatId !== '') {
    syncActivity(chatId)
  }

  const notice = batchNotice({
    total: messages.length,
    deleted: deleted.length,
    failed: failed.length,
    uncertain: uncertain.length,
    quota: quotaNotice,
    singleRefusal,
  })
  if (notice !== null) {
    showToast({
      kind: 'error',
      message: notice,
      dedupeKey: attemptKey,
    })
  }

  return {
    deleted,
    failed,
    uncertain,
    message:
      failed.length === 0 && uncertain.length === 0
        ? successMessage(deleted.length)
        : '',
  }
}

function currentGeneration(): number {
  return generation
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

function classifyDeleteError(error: unknown): DeleteProblem {
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
    return { kind: 'refused', quota: null }
  }

  if (error.kind === 'http' && error.status === 466) {
    return {
      kind: 'refused',
      quota: deleteTariffNotice(classifyTariffLimit(error.responseBody)),
    }
  }

  if (
    error.kind === 'http' &&
    (error.status === 400 || error.status === 403 || error.status === 469)
  ) {
    return { kind: 'refused', quota: null }
  }

  return { kind: 'uncertain' }
}

function deleteTariffNotice(kind: TariffLimitKind): string {
  if (kind === 'chats') {
    return deleteChatQuotaMessage
  }
  if (kind === 'method') {
    return deleteMethodQuotaMessage
  }
  if (kind === 'both') {
    return deleteBothQuotaMessage
  }
  return deleteTariffLimitMessage
}

function batchNotice(input: {
  total: number
  deleted: number
  failed: number
  uncertain: number
  quota: string | null
  singleRefusal: string | null
}): string | null {
  if (input.failed === 0 && input.uncertain === 0) {
    return null
  }

  if (input.total === 1) {
    if (input.uncertain === 1) {
      return deleteUnconfirmedMessage
    }
    return input.singleRefusal ?? deleteRefusedMessage
  }

  const parts: string[] = []
  if (input.deleted > 0) {
    parts.push(`Удалено ${String(input.deleted)}.`)
  }
  if (input.failed > 0) {
    parts.push(`Не удалось удалить ${String(input.failed)}.`)
  }
  if (input.uncertain > 0) {
    parts.push(`Не подтверждено ${String(input.uncertain)}.`)
  }
  if (input.quota !== null) {
    parts.push(input.quota)
  }
  return parts.join(' ')
}

function successMessage(deleted: number): string {
  if (deleted === 0) {
    return ''
  }
  return deleted === 1 ? 'Сообщение удалено.' : `Удалено ${String(deleted)}.`
}

function syncActivity(chatId: string): void {
  rewindDisplayedPreview(chatId, latestDisplayedActivity(chatId))
}
