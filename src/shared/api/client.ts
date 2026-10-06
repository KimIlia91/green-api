import {
  receiveTimeoutMaxSeconds,
  receiveTimeoutMinSeconds,
  requestTimeouts,
  type RequestTimeouts,
} from '../config/index.ts'

import type {
  ChatDirectoryEntry,
  ChatHistoryEntry,
  ChatHistoryParams,
  CheckAccountParams,
  CheckAccountResult,
  DeleteNotificationResult,
  DeleteMessageParams,
  EditMessageParams,
  EditMessageResult,
  ForwardMessagesParams,
  ForwardMessagesResult,
  GetContactInfoParams,
  GetContactInfoResult,
  GetStateInstanceResult,
  GreenApiConnection,
  ReadChatParams,
  ReadChatResult,
  ReceivedNotification,
  SendMessageParams,
  SendMessageResult,
} from './dto.ts'
import { GreenApiError } from './errors.ts'
import { scheduleRequest } from './request-rate.ts'
import {
  sendHttpRequest,
  type HttpRequest,
  type HttpResponseBody,
} from './http.ts'
import {
  parseChatDirectory,
  parseChatHistory,
  parseCheckAccount,
  parseDeleteNotification,
  parseEditMessage,
  parseForwardMessages,
  parseGetContactInfo,
  parseGetStateInstance,
  parseReadChat,
  parseReceivedNotification,
  parseSendMessage,
} from './parse.ts'

export type GreenApiClientOptions = {
  fetchImpl?: typeof fetch
  timeouts?: RequestTimeouts
}

export type GreenApiRequestOptions = {
  signal?: AbortSignal
}

export type ReceiveNotificationOptions = GreenApiRequestOptions & {
  receiveTimeoutSeconds?: number
}

export type GreenApiClient = {
  getStateInstance: (
    options?: GreenApiRequestOptions,
  ) => Promise<GetStateInstanceResult>
  checkAccount: (
    params: CheckAccountParams,
    options?: GreenApiRequestOptions,
  ) => Promise<CheckAccountResult>
  getContactInfo: (
    params: GetContactInfoParams,
    options?: GreenApiRequestOptions,
  ) => Promise<GetContactInfoResult>
  sendMessage: (
    params: SendMessageParams,
    options?: GreenApiRequestOptions,
  ) => Promise<SendMessageResult>
  editMessage: (
    params: EditMessageParams,
    options?: GreenApiRequestOptions,
  ) => Promise<EditMessageResult>
  forwardMessages: (
    params: ForwardMessagesParams,
    options?: GreenApiRequestOptions,
  ) => Promise<ForwardMessagesResult>
  deleteMessage: (
    params: DeleteMessageParams,
    options?: GreenApiRequestOptions,
  ) => Promise<void>
  readChat: (
    params: ReadChatParams,
    options?: GreenApiRequestOptions,
  ) => Promise<ReadChatResult>
  getChats: (options?: GreenApiRequestOptions) => Promise<ChatDirectoryEntry[]>
  getChatHistory: (
    params: ChatHistoryParams,
    options?: GreenApiRequestOptions,
  ) => Promise<ChatHistoryEntry[]>
  receiveNotification: (
    options?: ReceiveNotificationOptions,
  ) => Promise<ReceivedNotification | null>
  deleteNotification: (
    receiptId: number,
    options?: GreenApiRequestOptions,
  ) => Promise<DeleteNotificationResult>
}

type NormalizedConnection = {
  baseUrl: string
  idInstance: string
  apiTokenInstance: string
}

const approvedHost = /^(?:api|\d+\.api)\.green-api\.com$/

export function createGreenApiClient(
  connection: GreenApiConnection,
  options: GreenApiClientOptions = {},
): GreenApiClient {
  const normalized = normalizeConnection(connection)
  const timeouts = options.timeouts ?? requestTimeouts
  const fetchImpl = options.fetchImpl

  const instanceId = rateInstanceId(normalized)

  function limited<T>(
    method: string,
    signal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return scheduleRequest({
      instanceId,
      method,
      signal: signal ?? new AbortController().signal,
      run,
    })
  }

  const request = (
    methodName: string,
    init: Omit<HttpRequest, 'url' | 'fetchImpl'> & {
      extraPath?: string
      query?: Record<string, string>
    },
  ) => {
    const url = methodUrl(normalized, methodName, init.extraPath, init.query)
    return sendHttpRequest({
      url,
      method: init.method,
      jsonBody: init.jsonBody,
      timeoutMs: init.timeoutMs,
      signal: init.signal,
      fetchImpl,
    })
  }

  return {
    getStateInstance(requestOptions) {
      return limited(
        'getStateInstance',
        requestOptions?.signal,
        async (signal) => {
          const body = await request('getStateInstance', {
            method: 'GET',
            timeoutMs: timeouts.requestTimeoutMs,
            signal,
          })
          return parseGetStateInstance(expectJson(body, 'GetStateInstance'))
        },
      )
    },

    async checkAccount(params, requestOptions) {
      const jsonBody = checkAccountBody(params)
      return limited('checkAccount', requestOptions?.signal, async (signal) => {
        const body = await request('checkAccount', {
          method: 'POST',
          jsonBody,
          timeoutMs: timeouts.requestTimeoutMs,
          signal,
        })
        return parseCheckAccount(expectJson(body, 'CheckAccount'))
      })
    },

    async getContactInfo(params, requestOptions) {
      const jsonBody = getContactInfoBody(params)
      return limited(
        'getContactInfo',
        requestOptions?.signal,
        async (signal) => {
          const body = await request('getContactInfo', {
            method: 'POST',
            jsonBody,
            timeoutMs: timeouts.requestTimeoutMs,
            signal,
          })
          return parseGetContactInfo(expectJson(body, 'GetContactInfo'))
        },
      )
    },

    async sendMessage(params, requestOptions) {
      const jsonBody = sendMessageBody(params)
      return limited('sendMessage', requestOptions?.signal, async (signal) => {
        const body = await request('sendMessage', {
          method: 'POST',
          jsonBody,
          timeoutMs: timeouts.requestTimeoutMs,
          signal,
        })
        return parseSendMessage(expectJson(body, 'SendMessage'))
      })
    },

    async editMessage(params, requestOptions) {
      const jsonBody = editMessageBody(params)
      return limited('editMessage', requestOptions?.signal, async (signal) => {
        const body = await request('editMessage', {
          method: 'POST',
          jsonBody,
          timeoutMs: timeouts.requestTimeoutMs,
          signal,
        })
        return parseEditMessage(expectJson(body, 'EditMessage'))
      })
    },

    async forwardMessages(params, requestOptions) {
      const jsonBody = forwardMessagesBody(params)
      return limited(
        'forwardMessages',
        requestOptions?.signal,
        async (signal) => {
          const body = await request('forwardMessages', {
            method: 'POST',
            jsonBody,
            timeoutMs: timeouts.requestTimeoutMs,
            signal,
          })
          return parseForwardMessages(expectJson(body, 'ForwardMessages'))
        },
      )
    },

    async readChat(params, requestOptions) {
      const jsonBody = readChatBody(params)
      return limited('readChat', requestOptions?.signal, async (signal) => {
        const body = await request('readChat', {
          method: 'POST',
          jsonBody,
          timeoutMs: timeouts.requestTimeoutMs,
          signal,
        })
        const payload = expectJson(body, 'ReadChat')
        return parseReadChat(payload)
      })
    },

    async deleteMessage(params, requestOptions) {
      const jsonBody = deleteMessageBody(params)
      return limited(
        'deleteMessage',
        requestOptions?.signal,
        async (signal) => {
          const body = await request('deleteMessage', {
            method: 'POST',
            jsonBody,
            timeoutMs: timeouts.requestTimeoutMs,
            signal,
          })
          if (body.kind === 'empty' || body.kind === 'json') {
            return
          }
          throw new GreenApiError(
            'invalid-response',
            'DeleteMessage response was not empty',
          )
        },
      )
    },

    getChats(requestOptions) {
      return limited('getChats', requestOptions?.signal, async (signal) => {
        const body = await request('getChats', {
          method: 'GET',
          timeoutMs: timeouts.requestTimeoutMs,
          signal,
        })
        return parseChatDirectory(expectJson(body, 'GetChats'))
      })
    },

    async getChatHistory(params, requestOptions) {
      const jsonBody = chatHistoryBody(params)
      return limited(
        'getChatHistory',
        requestOptions?.signal,
        async (signal) => {
          const body = await request('getChatHistory', {
            method: 'POST',
            jsonBody,
            timeoutMs: timeouts.requestTimeoutMs,
            signal,
          })
          return parseChatHistory(expectJson(body, 'GetChatHistory'))
        },
      )
    },

    async receiveNotification(requestOptions) {
      const receiveTimeoutSeconds = resolveReceiveTimeout(
        requestOptions?.receiveTimeoutSeconds,
        timeouts,
      )
      const bufferMs =
        timeouts.clientReceiveTimeoutMs - timeouts.receiveTimeoutSeconds * 1000
      return limited(
        'receiveNotification',
        requestOptions?.signal,
        async (signal) => {
          const body = await request('receiveNotification', {
            method: 'GET',
            query: { receiveTimeout: String(receiveTimeoutSeconds) },
            timeoutMs: receiveTimeoutSeconds * 1000 + bufferMs,
            signal,
          })

          if (
            body.kind === 'empty' ||
            (body.kind === 'json' && body.value === null)
          ) {
            return null
          }

          return parseReceivedNotification(
            expectJson(body, 'ReceiveNotification'),
          )
        },
      )
    },

    async deleteNotification(receiptId, requestOptions) {
      if (!Number.isSafeInteger(receiptId) || receiptId < 0) {
        throw new GreenApiError(
          'invalid-request',
          'receiptId must be a non-negative integer',
        )
      }

      return limited(
        'deleteNotification',
        requestOptions?.signal,
        async (signal) => {
          const body = await request('deleteNotification', {
            method: 'DELETE',
            extraPath: `/${String(receiptId)}`,
            timeoutMs: timeouts.requestTimeoutMs,
            signal,
          })
          return parseDeleteNotification(expectJson(body, 'DeleteNotification'))
        },
      )
    },
  }
}

function normalizeConnection(
  connection: GreenApiConnection,
): NormalizedConnection {
  let url: URL
  try {
    url = new URL(connection.apiUrl)
  } catch {
    throw new GreenApiError('invalid-connection', 'apiUrl is not a valid URL')
  }

  const path = url.pathname.replace(/\/+$/, '')
  const idInstance = connection.idInstance.trim()
  const apiTokenInstance = connection.apiTokenInstance.trim()

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    (url.port !== '' && url.port !== '443') ||
    !approvedHost.test(url.hostname) ||
    (path !== '' && path !== '/v3')
  ) {
    throw new GreenApiError(
      'invalid-connection',
      'apiUrl must be an https host from the GREEN-API cabinet',
    )
  }

  if (!/^\d+$/.test(idInstance)) {
    throw new GreenApiError(
      'invalid-connection',
      'idInstance must contain only digits',
    )
  }

  if (!/^[A-Za-z0-9]+$/.test(apiTokenInstance)) {
    throw new GreenApiError(
      'invalid-connection',
      'apiTokenInstance contains unsupported characters',
    )
  }

  return {
    baseUrl: path === '/v3' ? `${url.origin}/v3` : url.origin,
    idInstance,
    apiTokenInstance,
  }
}

function rateInstanceId(connection: NormalizedConnection): string {
  return `${connection.baseUrl}\u0000${connection.idInstance}`
}

function methodUrl(
  connection: NormalizedConnection,
  methodName: string,
  extraPath = '',
  query?: Record<string, string>,
): URL {
  const url = new URL(
    `${connection.baseUrl}/waInstance${connection.idInstance}/${methodName}/${connection.apiTokenInstance}${extraPath}`,
  )

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
  }

  return url
}

function expectJson(body: HttpResponseBody, methodName: string): unknown {
  if (body.kind !== 'json') {
    throw new GreenApiError(
      'invalid-response',
      `${methodName} returned an unexpected response`,
    )
  }
  return body.value
}

function checkAccountBody(params: CheckAccountParams): {
  phoneNumber: number
  force?: boolean
} {
  if (!isSupportedPhoneNumber(params.phoneNumber)) {
    throw new GreenApiError(
      'invalid-request',
      'phoneNumber must be an integer of 7 to 15 digits',
    )
  }

  if (params.force !== undefined && typeof params.force !== 'boolean') {
    throw new GreenApiError('invalid-request', 'force must be a boolean')
  }

  return params.force === undefined
    ? { phoneNumber: params.phoneNumber }
    : { phoneNumber: params.phoneNumber, force: params.force }
}

function chatHistoryBody(params: ChatHistoryParams): {
  chatId: string
  count: number
} {
  if (params.chatId.trim() === '') {
    throw new GreenApiError('invalid-request', 'chatId is required')
  }

  if (!Number.isSafeInteger(params.count) || params.count < 1) {
    throw new GreenApiError(
      'invalid-request',
      'count must be a positive integer',
    )
  }

  return { chatId: params.chatId, count: params.count }
}

function getContactInfoBody(params: GetContactInfoParams): { chatId: string } {
  if (params.chatId.trim() === '') {
    throw new GreenApiError('invalid-request', 'chatId is required')
  }

  return { chatId: params.chatId }
}

function isSupportedPhoneNumber(value: number): boolean {
  if (!Number.isSafeInteger(value) || value < 0) {
    return false
  }
  const digits = String(value)
  return digits.length >= 7 && digits.length <= 15
}

function forwardMessagesBody(params: ForwardMessagesParams): {
  chatId: string
  chatIdFrom: string
  messages: string[]
} {
  if (params.chatId.trim() === '' || params.chatIdFrom.trim() === '') {
    throw new GreenApiError('invalid-request', 'chatId is required')
  }

  if (params.messages.length === 0) {
    throw new GreenApiError('invalid-request', 'messages must not be empty')
  }

  const messages = params.messages.map((id) => {
    if (id.trim() === '') {
      throw new GreenApiError('invalid-request', 'idMessage is required')
    }
    return id
  })

  return {
    chatId: params.chatId,
    chatIdFrom: params.chatIdFrom,
    messages,
  }
}

function readChatBody(params: ReadChatParams): {
  chatId: string
  idMessage: string
} {
  if (params.chatId.trim() === '') {
    throw new GreenApiError('invalid-request', 'chatId is required')
  }

  if (params.idMessage.trim() === '') {
    throw new GreenApiError('invalid-request', 'idMessage is required')
  }

  return {
    chatId: params.chatId,
    idMessage: params.idMessage,
  }
}

function deleteMessageBody(params: DeleteMessageParams): {
  chatId: string
  idMessage: string
  onlySenderDelete: boolean
} {
  if (params.chatId.trim() === '') {
    throw new GreenApiError('invalid-request', 'chatId is required')
  }

  if (params.idMessage.trim() === '') {
    throw new GreenApiError('invalid-request', 'idMessage is required')
  }

  return {
    chatId: params.chatId,
    idMessage: params.idMessage,
    onlySenderDelete: params.onlySenderDelete === true,
  }
}

function editMessageBody(params: EditMessageParams): {
  chatId: string
  idMessage: string
  message: string
} {
  if (params.chatId.trim() === '') {
    throw new GreenApiError('invalid-request', 'chatId is required')
  }

  if (params.idMessage.trim() === '') {
    throw new GreenApiError('invalid-request', 'idMessage is required')
  }

  if (params.message.length === 0 || params.message.length > 4000) {
    throw new GreenApiError(
      'invalid-request',
      'message length must be from 1 to 4000 characters',
    )
  }

  return {
    chatId: params.chatId,
    idMessage: params.idMessage,
    message: params.message,
  }
}

function sendMessageBody(params: SendMessageParams): {
  chatId: string
  message: string
  typingTime?: number
  quotedMessageId?: string
} {
  if (params.chatId.trim() === '') {
    throw new GreenApiError('invalid-request', 'chatId is required')
  }

  if (params.message.length === 0 || params.message.length > 4000) {
    throw new GreenApiError(
      'invalid-request',
      'message length must be from 1 to 4000 characters',
    )
  }

  if (
    params.typingTime !== undefined &&
    (!Number.isInteger(params.typingTime) ||
      params.typingTime < 1000 ||
      params.typingTime > 20000)
  ) {
    throw new GreenApiError(
      'invalid-request',
      'typingTime must be an integer from 1000 to 20000',
    )
  }

  if (
    params.quotedMessageId !== undefined &&
    params.quotedMessageId.trim() === ''
  ) {
    throw new GreenApiError(
      'invalid-request',
      'quotedMessageId must not be empty',
    )
  }

  return {
    chatId: params.chatId,
    message: params.message,
    ...(params.typingTime === undefined
      ? {}
      : { typingTime: params.typingTime }),
    ...(params.quotedMessageId === undefined
      ? {}
      : { quotedMessageId: params.quotedMessageId }),
  }
}

function resolveReceiveTimeout(
  override: number | undefined,
  timeouts: RequestTimeouts,
): number {
  const value = override ?? timeouts.receiveTimeoutSeconds
  if (
    !Number.isInteger(value) ||
    value < receiveTimeoutMinSeconds ||
    value > receiveTimeoutMaxSeconds
  ) {
    throw new GreenApiError(
      'invalid-request',
      `receiveTimeoutSeconds must be an integer from ${String(receiveTimeoutMinSeconds)} to ${String(receiveTimeoutMaxSeconds)}`,
    )
  }
  return value
}
