import { refreshPreviewText } from '@/entities/chat'
import {
  canEditMessage,
  editExpiredMessage,
  updateMessage,
  useMessageStore,
} from '@/entities/message'
import { sessionIdentity, useSessionStore } from '@/entities/session'
import {
  classifyTariffLimit,
  createGreenApiClient,
  GreenApiError,
} from '@/shared/api'
import type { GreenApiClient, TariffLimitKind } from '@/shared/api'
import { showToast } from '@/shared/lib/toast'

import {
  bindEditFlight,
  currentEditGeneration,
  unbindEditFlight,
} from './edit-flight.ts'
import { cancelEdit, setEditNotice, useEditStore } from './edit-session.ts'

export const editRefusedMessage = 'Сообщение не принято.'

export const editUnconfirmedMessage =
  'Не удалось подтвердить сохранение изменений'

const editChatQuotaMessage = 'Превышена квота чатов тарифа.'

const editMethodQuotaMessage = 'Превышена квота метода редактирования.'

const editBothQuotaMessage = 'Превышена квота чатов и метода редактирования.'

const editTariffLimitMessage = 'Сработало ограничение тарифа.'

export type SaveEditOutcome =
  | { status: 'expired'; message: string }
  | { status: 'invalid'; message: string }
  | { status: 'refused'; message: string }
  | { status: 'saved' }
  | { status: 'ignored' }

type EditClient = Pick<GreenApiClient, 'editMessage'>

type SaveEditOptions = {
  now?: () => number
  client?: EditClient
}

const messageLimit = 4000
let attemptSerial = 0

export async function saveEditedMessage(
  localId: string,
  text: string,
  options: SaveEditOptions = {},
): Promise<SaveEditOutcome> {
  const message = useMessageStore.getState().messagesById[localId]
  if (message === undefined) {
    return { status: 'ignored' }
  }

  const issue = textIssue(text)
  if (issue !== null) {
    rememberNotice(localId, issue)
    return { status: 'invalid', message: issue }
  }

  const connection = useSessionStore.getState().connection
  if (connection === null || message.providerId === null) {
    return { status: 'ignored' }
  }

  const now = options.now?.() ?? Date.now()
  if (!canEditMessage(message, now)) {
    const outcome = {
      status: 'expired' as const,
      message: editExpiredMessage,
    }
    rememberNotice(localId, outcome.message)
    return outcome
  }

  const sentAt = message.sentAt
  const generation = currentEditGeneration()
  const sessionKey = sessionIdentity(connection)
  const attemptKey = `edit:${localId}:${String((attemptSerial += 1))}`
  const controller = new AbortController()
  bindEditFlight(controller)
  try {
    const api = options.client ?? createGreenApiClient(connection)
    await api.editMessage(
      {
        chatId: message.chatId,
        idMessage: message.providerId,
        message: text,
      },
      { signal: controller.signal },
    )
  } catch (error) {
    if (isStale(generation, sessionKey) || isAbort(error)) {
      return { status: 'ignored' }
    }

    const refusal = refusalMessage(error)
    showToast({
      kind: 'error',
      message: refusal,
      dedupeKey: attemptKey,
    })
    return { status: 'refused', message: refusal }
  } finally {
    unbindEditFlight(controller)
  }

  if (isStale(generation, sessionKey)) {
    return { status: 'ignored' }
  }

  const current = useMessageStore.getState().messagesById[localId]
  if (current === undefined || current.sentAt !== sentAt) {
    return { status: 'ignored' }
  }

  updateMessage(localId, { text, edited: true })
  const ids =
    useMessageStore.getState().messageIdsByChatId[current.chatId] ?? []
  if (ids[ids.length - 1] === localId) {
    refreshPreviewText(current.chatId, text, current.createdAt)
  }
  cancelEdit()
  return { status: 'saved' }
}

function textIssue(text: string): string | null {
  if (text.trim() === '') {
    return 'Введите текст сообщения.'
  }

  if (text.length > messageLimit) {
    return 'Сообщение длиннее 4000 символов.'
  }

  return null
}

function rememberNotice(localId: string, notice: string): void {
  const session = useEditStore.getState().session
  if (session === null || session.localId !== localId) {
    return
  }

  setEditNotice(notice)
}

function isStale(generation: number, sessionKey: string): boolean {
  return (
    generation !== currentEditGeneration() ||
    sessionIdentity(useSessionStore.getState().connection) !== sessionKey
  )
}

function editTariffNotice(kind: TariffLimitKind): string {
  if (kind === 'chats') {
    return editChatQuotaMessage
  }
  if (kind === 'method') {
    return editMethodQuotaMessage
  }
  if (kind === 'both') {
    return editBothQuotaMessage
  }
  return editTariffLimitMessage
}

function isAbort(error: unknown): boolean {
  return error instanceof GreenApiError && error.kind === 'abort'
}

function refusalMessage(error: unknown): string {
  if (!(error instanceof GreenApiError)) {
    return editUnconfirmedMessage
  }

  if (error.kind === 'invalid-request') {
    return 'Сообщение не отправлено.'
  }

  if (error.kind === 'http' && error.status === 466) {
    return editTariffNotice(classifyTariffLimit(error.responseBody))
  }

  if (error.kind === 'http' && error.status === 403) {
    return 'Отправка ограничена для этого аккаунта.'
  }

  if (error.kind === 'http' && error.status === 469) {
    return 'Слишком много запросов. Повторите позже.'
  }

  if (error.kind === 'http' && error.status === 400) {
    return editRefusedMessage
  }

  return editUnconfirmedMessage
}
