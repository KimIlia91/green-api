import {
  classifyTariffLimit,
  createGreenApiClient,
  GreenApiError,
} from '@/shared/api'
import type {
  CheckAccountResult,
  GetContactInfoResult,
  GreenApiClient,
  TariffLimitKind,
} from '@/shared/api'
import { showToast } from '@/shared/lib/toast'
import { upsertChat, useChatStore, type Chat } from '@/entities/chat'
import {
  sessionIdentity,
  useSessionStore,
  type SessionConnection,
} from '@/entities/session'

import { contactProfile } from './contact-profile.ts'
import { normalizePhone, phoneIssueMessage } from './phone.ts'

export const accountMissingMessage = 'На этом номере не найден аккаунт MAX'

export const checkAccountFailureMessage = 'Не удалось проверить номер'

const checkChatQuotaMessage = 'Превышена квота чатов тарифа.'

const checkMethodQuotaMessage = 'Превышена квота метода проверки аккаунта.'

const checkBothQuotaMessage =
  'Превышена квота чатов и метода проверки аккаунта.'

const checkTariffLimitMessage = 'Сработало ограничение тарифа.'

let checkAttemptSerial = 0

export type CreateChatOutcome =
  | { status: 'created'; chatId: string }
  | { status: 'invalid'; message: string }
  | { status: 'rejected'; message: string }
  | { status: 'ignored' }

type CreateChatClient = Pick<GreenApiClient, 'checkAccount'> &
  Partial<Pick<GreenApiClient, 'getContactInfo'>>

type CreateChatOptions = {
  rawPhone: string
  signal: AbortSignal
  isStale: () => boolean
  client?: CreateChatClient
}

let profileGeneration = 0
const profileControllers = new Set<AbortController>()
const profileAttempted = new Set<string>()
const profileInflight = new Set<string>()

export function cancelChatProfiles(): void {
  profileGeneration += 1
  for (const controller of profileControllers) {
    controller.abort()
  }
  profileControllers.clear()
  profileAttempted.clear()
  profileInflight.clear()
}

export function ensureContactProfile(chatId: string): void {
  const chat = useChatStore.getState().chatsById[chatId]
  if (chat === undefined || filled(chat.name) !== null) {
    return
  }

  if (profileAttempted.has(chatId) || profileInflight.has(chatId)) {
    return
  }

  const connection = useSessionStore.getState().connection
  if (connection === null) {
    return
  }

  void loadContactProfile(chatId, connection, undefined)
}

export async function createChatFromPhone({
  rawPhone,
  signal,
  isStale,
  client,
}: CreateChatOptions): Promise<CreateChatOutcome> {
  const phone = normalizePhone(rawPhone)
  if (!phone.ok) {
    return { status: 'invalid', message: phoneIssueMessage(phone.issue) }
  }

  const connection = useSessionStore.getState().connection
  if (connection === null) {
    return { status: 'rejected', message: 'Подключение не найдено.' }
  }

  try {
    const api = client ?? createGreenApiClient(connection)
    const result = await api.checkAccount(
      { phoneNumber: Number(phone.digits) },
      { signal },
    )

    if (signal.aborted || isStale()) {
      return { status: 'ignored' }
    }

    const outcome = applyCheckAccountResult(result, phone.digits)
    if (outcome.status === 'created') {
      void loadContactProfile(outcome.chatId, connection, client)
    }
    return outcome
  } catch (error) {
    if (
      signal.aborted ||
      isStale() ||
      (error instanceof GreenApiError && error.kind === 'abort')
    ) {
      return { status: 'ignored' }
    }

    showCheckToast(checkAccountNotice(error))
    return { status: 'rejected', message: '' }
  }
}

function applyCheckAccountResult(
  result: CheckAccountResult,
  digits: string,
): CreateChatOutcome {
  if ('status' in result) {
    showCheckToast(checkAccountFailureMessage)
    return { status: 'rejected', message: '' }
  }

  if (!result.exist) {
    return { status: 'rejected', message: accountMissingMessage }
  }

  if (result.chatId.trim() === '') {
    showCheckToast(checkAccountFailureMessage)
    return { status: 'rejected', message: '' }
  }

  const current = useChatStore.getState().chatsById[result.chatId]
  const chat: Chat = {
    chatId: result.chatId,
    phoneNumber: digits,
    name: current?.name ?? null,
    username: current?.username ?? null,
    preview: current?.preview ?? null,
    previewForwarded: current?.previewForwarded ?? false,
    lastActivityAt: current?.lastActivityAt ?? null,
    unseenIncomingIds: current?.unseenIncomingIds ?? [],
  }
  upsertChat(chat)
  return { status: 'created', chatId: chat.chatId }
}

async function loadContactProfile(
  chatId: string,
  connection: SessionConnection,
  client: CreateChatClient | undefined,
): Promise<void> {
  const getContactInfo = client?.getContactInfo
  if (client !== undefined && getContactInfo === undefined) {
    return
  }

  if (profileInflight.has(chatId)) {
    return
  }

  profileAttempted.add(chatId)
  profileInflight.add(chatId)
  const generation = profileGeneration
  const sessionKey = sessionIdentity(connection)
  const controller = new AbortController()
  profileControllers.add(controller)

  try {
    const info = await (
      getContactInfo ?? createGreenApiClient(connection).getContactInfo
    )({ chatId }, { signal: controller.signal })
    applyContactProfile(chatId, info, generation, sessionKey, controller.signal)
  } catch {
    // Сбой профиля оставляет чат, который CheckAccount уже создал.
  } finally {
    profileControllers.delete(controller)
    profileInflight.delete(chatId)
  }
}

function filled(value: string | null): string | null {
  if (value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function applyContactProfile(
  chatId: string,
  info: GetContactInfoResult,
  generation: number,
  sessionKey: string,
  signal: AbortSignal,
): void {
  // Поздний профиль не применяется после выхода или более новой попытки.
  if (
    generation !== profileGeneration ||
    signal.aborted ||
    sessionIdentity(useSessionStore.getState().connection) !== sessionKey
  ) {
    return
  }

  const current = useChatStore.getState().chatsById[chatId]
  if (current === undefined) {
    return
  }

  const profile = contactProfile(info)
  upsertChat({
    chatId,
    name: profile.name,
    username: profile.username,
    phoneNumber: profile.phoneNumber ?? current.phoneNumber,
  })
}

function showCheckToast(message: string): void {
  // Новый ключ, чтобы следующий сбой не схлопнулся с прошлым toast.
  checkAttemptSerial += 1
  showToast({
    kind: 'error',
    message,
    dedupeKey: `check-account:${String(checkAttemptSerial)}`,
  })
}

function checkAccountNotice(error: unknown): string {
  if (
    error instanceof GreenApiError &&
    error.kind === 'http' &&
    error.status === 466
  ) {
    return checkTariffNotice(classifyTariffLimit(error.responseBody))
  }

  return checkAccountFailureMessage
}

function checkTariffNotice(kind: TariffLimitKind): string {
  if (kind === 'chats') {
    return checkChatQuotaMessage
  }
  if (kind === 'method') {
    return checkMethodQuotaMessage
  }
  if (kind === 'both') {
    return checkBothQuotaMessage
  }
  return checkTariffLimitMessage
}
