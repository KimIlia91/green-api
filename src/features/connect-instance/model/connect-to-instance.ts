import { establishSession, type SessionConnection } from '@/entities/session'
import {
  createGreenApiClient,
  GreenApiError,
  instanceStates,
  type GreenApiClient,
  type InstanceState,
} from '@/shared/api'

export type ConnectDraft = {
  apiUrl: string
  idInstance: string
  apiTokenInstance: string
}

export type ConnectField = keyof ConnectDraft

export type ConnectFieldErrors = Partial<Record<ConnectField, string>>

export type ConnectOutcome =
  | { status: 'authorized' }
  | { status: 'invalid'; fieldErrors: ConnectFieldErrors }
  | { status: 'rejected'; message: string; field?: ConnectField }
  | { status: 'ignored' }

type ConnectClient = Pick<GreenApiClient, 'getStateInstance'>

type ConnectToInstanceOptions = {
  draft: ConnectDraft
  signal: AbortSignal
  isStale: () => boolean
  client?: ConnectClient
}

const requiredFieldMessage: Record<ConnectField, string> = {
  apiUrl: 'Укажите apiUrl из личного кабинета',
  idInstance: 'Укажите idInstance',
  apiTokenInstance: 'Укажите apiTokenInstance',
}

const instanceStateMessage: Record<
  Exclude<InstanceState, 'authorized'>,
  string
> = {
  notAuthorized:
    'Инстанс не авторизован. Привяжите аккаунт MAX в личном кабинете GREEN-API. Это не ошибка токена.',
  blocked:
    'Аккаунт MAX заблокирован. Подключение к переписке недоступно. Это не ошибка токена.',
  starting:
    'Инстанс запускается. Подождите и повторите подключение. Это не ошибка токена.',
  suspended:
    'На аккаунте временные ограничения отправки. Вход в переписку открывается только для состояния authorized. Это не ошибка токена.',
  pendingPassword:
    'Для завершения авторизации нужен пароль двухфакторной защиты. Завершите вход в личном кабинете GREEN-API. Это не ошибка токена.',
}

export const readinessMessage = 'Не удалось подтвердить готовность инстанса.'

export const stateInstanceRateLimitMessage =
  'Слишком частые запросы к GREEN-API. Подождите и повторите попытку.'

export function validateConnectDraft(
  draft: ConnectDraft,
):
  | { ok: true; connection: SessionConnection }
  | { ok: false; fieldErrors: ConnectFieldErrors } {
  const connection = {
    apiUrl: draft.apiUrl.trim(),
    idInstance: draft.idInstance.trim(),
    apiTokenInstance: draft.apiTokenInstance.trim(),
  }
  const fieldErrors: ConnectFieldErrors = {}

  for (const field of Object.keys(requiredFieldMessage) as ConnectField[]) {
    if (connection[field] === '') {
      fieldErrors[field] = requiredFieldMessage[field]
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors }
  }

  return { ok: true, connection }
}

export function messageForInstanceState(
  state: Exclude<InstanceState, 'authorized'>,
): string {
  return instanceStateMessage[state]
}

export async function connectToInstance({
  draft,
  signal,
  isStale,
  client,
}: ConnectToInstanceOptions): Promise<ConnectOutcome> {
  const validated = validateConnectDraft(draft)
  if (!validated.ok) {
    return { status: 'invalid', fieldErrors: validated.fieldErrors }
  }

  try {
    const api = client ?? createGreenApiClient(validated.connection)
    const result = await api.getStateInstance({ signal })

    if (signal.aborted || isStale()) {
      return { status: 'ignored' }
    }

    if (result.stateInstance === 'authorized') {
      establishSession(validated.connection, result.stateInstance)
      return { status: 'authorized' }
    }

    return {
      status: 'rejected',
      message: messageForInstanceState(result.stateInstance),
    }
  } catch (error) {
    if (isIgnoredError(error, signal, isStale)) {
      return { status: 'ignored' }
    }

    return describeConnectFailure(error)
  }
}

function isIgnoredError(
  error: unknown,
  signal: AbortSignal,
  isStale: () => boolean,
): boolean {
  return (
    signal.aborted ||
    isStale() ||
    (error instanceof GreenApiError && error.kind === 'abort')
  )
}

function describeConnectFailure(error: unknown): ConnectOutcome {
  if (!(error instanceof GreenApiError)) {
    return {
      status: 'rejected',
      message: 'Не удалось выполнить подключение.',
    }
  }

  if (error.kind === 'invalid-connection') {
    return describeInvalidConnection(error.message)
  }

  if (error.kind === 'invalid-response') {
    return { status: 'rejected', message: readinessMessage }
  }

  if (error.kind === 'timeout') {
    return {
      status: 'rejected',
      message: 'Истекло время ожидания ответа GREEN-API. Повторите попытку.',
    }
  }

  if (error.kind === 'network') {
    return {
      status: 'rejected',
      message:
        'Не удалось связаться с GREEN-API. Проверьте apiUrl и доступность хоста.',
    }
  }

  if (error.kind === 'http' && error.status === 429) {
    return { status: 'rejected', message: stateInstanceRateLimitMessage }
  }

  if (error.kind === 'http') {
    const status = error.status === null ? '' : ` HTTP ${String(error.status)}`
    return {
      status: 'rejected',
      message: `GREEN-API не принял запрос${status}. Проверьте реквизиты в личном кабинете и повторите попытку.`,
    }
  }

  return {
    status: 'rejected',
    message: 'Не удалось выполнить подключение.',
  }
}

function describeInvalidConnection(message: string): ConnectOutcome {
  if (message.includes('idInstance')) {
    return {
      status: 'rejected',
      field: 'idInstance',
      message: 'idInstance должен состоять только из цифр',
    }
  }

  if (message.includes('apiTokenInstance')) {
    return {
      status: 'rejected',
      field: 'apiTokenInstance',
      message: 'apiTokenInstance содержит недопустимые символы',
    }
  }

  return {
    status: 'rejected',
    field: 'apiUrl',
    message: 'Укажите https-адрес apiUrl из личного кабинета GREEN-API',
  }
}

export const knownRejectedStates = instanceStates.filter(
  (state): state is Exclude<InstanceState, 'authorized'> =>
    state !== 'authorized',
)
