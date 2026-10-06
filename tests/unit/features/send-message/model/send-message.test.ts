import { beforeEach, describe, expect, it } from 'vitest'

import {
  resetChats,
  selectChat,
  selectChatIds,
  upsertChat,
  useChatStore,
} from '@/entities/chat'
import { useMessageStore, resetMessages } from '@/entities/message'
import {
  clearSession,
  establishSession,
  useSessionStore,
} from '@/entities/session'
import { GreenApiError, type SendMessageResult } from '@/shared/api'
import { resetToastStore, useToastStore } from '@/shared/lib/toast'

import {
  clearDrafts,
  selectDraft,
  selectReply,
  setDraft,
  setReply,
  useDraftStore,
} from '@/features/send-message/model/drafts.ts'
import {
  bothQuotaMessage,
  cancelOutgoingMessages,
  chatQuotaMessage,
  methodQuotaMessage,
  reportOutgoingTextRefusal,
  retryChatMessage,
  sendChatMessage,
  tariffLimitMessage,
} from '@/features/send-message/model/send-message.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('sendChatMessage', () => {
  beforeEach(() => {
    resetToastStore()
    cancelOutgoingMessages()
    clearDrafts()
    resetMessages()
    resetChats()
    clearSession()
    establishSession(connection, 'authorized')
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: null,
      username: null,
    })
    upsertChat({
      chatId: '20000000',
      phoneNumber: '375291234567',
      name: null,
      username: null,
    })
    selectChat('10000000')
  })

  it('rejects empty text and text over 4000 characters without a message', async () => {
    setDraft('10000000', '   ')
    const empty = await sendChatMessage('10000000', '   ')
    setDraft('10000000', 'a'.repeat(4001))
    const long = await sendChatMessage('10000000', 'a'.repeat(4001))

    expect(empty.status).toBe('invalid')
    expect(long).toEqual({
      status: 'invalid',
      message: 'Сообщение длиннее 4000 символов.',
    })
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toBe(
      undefined,
    )
    expect(useToastStore.getState().toasts).toEqual([])
    expect(selectDraft('10000000')(useDraftStore.getState())).toBe(
      'a'.repeat(4001),
    )
  })

  it('queues a message and keeps the same local id', async () => {
    const calls: string[] = []
    const outcome = await sendChatMessage('10000000', '  hello \n next  ', {
      createId: () => 'local-1',
      now: () => 1_700_000_000_000,
      client: {
        sendMessage: (params) => {
          calls.push(params.chatId, params.message)
          expect(params.quotedMessageId).toBeUndefined()
          return Promise.resolve({ idMessage: 'provider-1' })
        },
      },
    })

    const message = useMessageStore.getState().messagesById['local-1']
    expect(outcome).toEqual({ status: 'accepted', localId: 'local-1' })
    expect(calls).toEqual(['10000000', '  hello \n next  '])
    expect(message).toMatchObject({
      localId: 'local-1',
      providerId: 'provider-1',
      chatId: '10000000',
      text: '  hello \n next  ',
      sendState: 'queued',
      errorText: null,
    })
    expect(useMessageStore.getState().localIdByProviderId['provider-1']).toBe(
      'local-1',
    )
    expect(selectDraft('10000000')(useDraftStore.getState())).toBe('')
    expect(await retryChatMessage('local-1')).toEqual({ status: 'blocked' })
    expect(selectChatIds(useChatStore.getState())[0]).toBe('10000000')
  })

  it('moves the chat when the outgoing message is created', async () => {
    await sendChatMessage('20000000', 'из приложения', {
      createId: () => 'local-order',
      now: () => 50_000,
      client: {
        sendMessage: () => Promise.resolve({ idMessage: 'provider-order' }),
      },
    })

    expect(selectChatIds(useChatStore.getState())).toEqual([
      '20000000',
      '10000000',
    ])
    expect(useChatStore.getState().chatsById['20000000']?.lastActivityAt).toBe(
      50_000,
    )
  })

  it('marks an explicit API refusal as failed and does not retry', async () => {
    let calls = 0
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'local-1',
      client: {
        sendMessage: () => {
          calls += 1
          return Promise.reject(
            new GreenApiError('http', 'rejected', { status: 400 }),
          )
        },
      },
    })

    expect(calls).toBe(1)
    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      sendState: 'failed',
      errorText: null,
    })
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
    ])
    expect(toastTexts()).toEqual(['Сообщение не принято.'])
    expect(toastTexts()[0]).not.toContain('hello')
  })

  it('shows one toast for one refused attempt and does not send again', async () => {
    let calls = 0
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'local-1',
      client: {
        sendMessage: () => {
          calls += 1
          return Promise.reject(
            new GreenApiError('http', 'rejected', { status: 403 }),
          )
        },
      },
    })
    reportOutgoingTextRefusal({ localId: 'local-1', status: 'failed' })

    expect(calls).toBe(1)
    expect(toastTexts()).toEqual(['Отправка ограничена для этого аккаунта.'])
  })

  it('names the chat quota only when the 466 body says it is exceeded', async () => {
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'local-chats',
      client: {
        sendMessage: () =>
          Promise.reject(
            new GreenApiError('http', 'quota', {
              status: 466,
              responseBody: {
                invokeStatus: {
                  status: 'QUOTE_ALLOWED',
                  description: 'https://console.green-api.com token abc123',
                },
                correspondentsStatus: {
                  status: 'CORRESPONDENTS_QUOTA_EXCEEDED',
                },
              },
            }),
          ),
      },
    })

    const message = useMessageStore.getState().messagesById['local-chats']
    expect(message?.sendState).toBe('failed')
    expect(message?.errorText).toBeNull()
    expect(toastTexts()).toEqual([chatQuotaMessage])
    expect(chatQuotaMessage).not.toMatch(/номер|сет|https|abc123|hello/i)
  })

  it('names the method quota only for an exceeded invoke status', async () => {
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'local-method',
      client: {
        sendMessage: () =>
          Promise.reject(
            new GreenApiError('http', 'quota', {
              status: 466,
              responseBody: {
                invokeStatus: { status: 'QUOTE_EXCEEDED' },
                quotaData: { status: 'QUOTE_ALLOWED' },
              },
            }),
          ),
      },
    })

    expect(
      useMessageStore.getState().messagesById['local-method']?.sendState,
    ).toBe('failed')
    expect(toastTexts()).toEqual([methodQuotaMessage])
    expect(methodQuotaMessage).not.toMatch(/чат/)
  })

  it('uses a generic tariff notice when the 466 body is not recognized', async () => {
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'local-tariff',
      client: {
        sendMessage: () =>
          Promise.reject(
            new GreenApiError('http', 'quota', {
              status: 466,
              responseBody: {
                invokeStatus: { status: 'QUOTE_ALLOWED' },
              },
            }),
          ),
      },
    })

    expect(toastTexts()).toEqual([tariffLimitMessage])
    expect(tariffLimitMessage).not.toMatch(/чат/)
  })

  it('names both quotas when the 466 body exceeds each', async () => {
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'local-both',
      client: {
        sendMessage: () =>
          Promise.reject(
            new GreenApiError('http', 'quota', {
              status: 466,
              responseBody: {
                invokeStatus: { status: 'QUOTA_EXCEEDED' },
                quotaData: { status: 'CORRESPONDENTS_QUOTA_EXCEEDED' },
              },
            }),
          ),
      },
    })

    expect(toastTexts()).toEqual([bothQuotaMessage])
  })

  it('marks timeout, network loss and an invalid body as unknown', async () => {
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'timeout',
      client: {
        sendMessage: () =>
          Promise.reject(new GreenApiError('timeout', 'timed out')),
      },
    })
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'network',
      client: {
        sendMessage: () =>
          Promise.reject(new GreenApiError('network', 'offline')),
      },
    })
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'blank',
      client: {
        sendMessage: () => Promise.resolve({ idMessage: '   ' }),
      },
    })

    expect(useMessageStore.getState().messagesById.timeout?.sendState).toBe(
      'unknown',
    )
    expect(useMessageStore.getState().messagesById.network?.sendState).toBe(
      'unknown',
    )
    expect(useMessageStore.getState().messagesById.blank?.sendState).toBe(
      'unknown',
    )
    expect(useMessageStore.getState().messagesById.timeout?.errorText).toBe(
      null,
    )
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('ignores a second send for the same chat while the first is in flight', async () => {
    const pending = deferred<SendMessageResult>()
    let calls = 0
    const first = sendChatMessage('10000000', 'hello', {
      createId: () => 'local-1',
      client: {
        sendMessage: () => {
          calls += 1
          return pending.promise
        },
      },
    })
    const second = await sendChatMessage('10000000', 'again', {
      createId: () => 'local-2',
    })

    expect(second).toEqual({ status: 'ignored' })
    expect(calls).toBe(1)
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
    ])
    pending.resolve({ idMessage: 'provider-1' })
    await first
  })

  it('keeps the original chat when the active chat changes', async () => {
    const pending = deferred<SendMessageResult>()
    let chatId = ''
    const request = sendChatMessage('10000000', 'hello', {
      createId: () => 'local-1',
      client: {
        sendMessage: (params) => {
          chatId = params.chatId
          return pending.promise
        },
      },
    })
    selectChat('20000000')
    pending.resolve({ idMessage: 'provider-1' })
    await request

    expect(chatId).toBe('10000000')
    expect(useMessageStore.getState().messagesById['local-1']?.chatId).toBe(
      '10000000',
    )
    expect(useSessionStore.getState().connection).not.toBeNull()
  })

  it('keeps a draft typed while the request is still running', async () => {
    const pending = deferred<SendMessageResult>()
    setDraft('10000000', 'hello')
    const request = sendChatMessage('10000000', 'hello', {
      createId: () => 'local-1',
      client: { sendMessage: () => pending.promise },
    })
    setDraft('10000000', 'next line')
    pending.resolve({ idMessage: 'provider-1' })
    await request

    expect(selectDraft('10000000')(useDraftStore.getState())).toBe('next line')
    expect(selectDraft('20000000')(useDraftStore.getState())).toBe('')
  })

  it('stores drafts separately for each chat', () => {
    setDraft('10000000', 'one')
    setDraft('20000000', 'two')
    expect(selectDraft('10000000')(useDraftStore.getState())).toBe('one')
    expect(selectDraft('20000000')(useDraftStore.getState())).toBe('two')
  })

  it('retries a failed message on the same local record', async () => {
    let calls = 0
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'local-1',
      client: {
        sendMessage: () => {
          calls += 1
          return Promise.reject(
            new GreenApiError('http', 'rejected', { status: 400 }),
          )
        },
      },
    })

    const retry = await retryChatMessage('local-1', false, {
      client: {
        sendMessage: () => {
          calls += 1
          return Promise.resolve({ idMessage: 'provider-1' })
        },
      },
    })

    expect(retry).toEqual({ status: 'accepted', localId: 'local-1' })
    expect(calls).toBe(2)
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
    ])
    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      providerId: 'provider-1',
      sendState: 'queued',
    })
  })

  it('asks for confirmation before retrying an unknown result', async () => {
    let calls = 0
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'local-1',
      client: {
        sendMessage: () => {
          calls += 1
          return Promise.reject(new GreenApiError('timeout', 'timed out'))
        },
      },
    })

    const confirm = await retryChatMessage('local-1')
    const blocked = await retryChatMessage('local-1', true, {
      client: {
        sendMessage: () => {
          calls += 1
          return Promise.resolve({ idMessage: 'provider-2' })
        },
      },
    })

    expect(confirm).toEqual({ status: 'confirm' })
    expect(useToastStore.getState().toasts).toEqual([])
    expect(blocked.status).toBe('accepted')
    expect(calls).toBe(2)
    expect(
      useMessageStore.getState().messageIdsByChatId['10000000'],
    ).toHaveLength(1)
  })

  it('does not apply a response after cancellation', async () => {
    const pending = deferred<SendMessageResult>()
    const request = sendChatMessage('10000000', 'hello', {
      createId: () => 'local-1',
      client: { sendMessage: () => pending.promise },
    })
    cancelOutgoingMessages()
    pending.resolve({ idMessage: 'provider-1' })
    await request

    expect(useMessageStore.getState().messagesById['local-1']?.sendState).toBe(
      'sending',
    )
    expect(useMessageStore.getState().messagesById['local-1']?.providerId).toBe(
      null,
    )
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('does not toast a refusal that arrives after the session changed', async () => {
    const pending = deferred<SendMessageResult>()
    const request = sendChatMessage('10000000', 'hello', {
      createId: () => 'local-1',
      client: { sendMessage: () => pending.promise },
    })
    clearSession()
    pending.reject(new GreenApiError('http', 'rejected', { status: 400 }))
    await request

    expect(useMessageStore.getState().messagesById['local-1']?.sendState).toBe(
      'sending',
    )
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('toasts one queued refusal and ignores a duplicate status', async () => {
    await sendChatMessage('10000000', 'секретный текст', {
      createId: () => 'local-1',
      client: {
        sendMessage: () => Promise.resolve({ idMessage: 'provider-1' }),
      },
    })

    reportOutgoingTextRefusal({ localId: 'local-1', status: 'failed' })
    reportOutgoingTextRefusal({ localId: 'local-1', status: 'failed' })
    reportOutgoingTextRefusal({ localId: 'local-1', status: 'noAccount' })

    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      sendState: 'queued',
      errorText: null,
    })
    expect(toastTexts()).toEqual(['Сообщение не доставлено.'])
    expect(toastTexts()[0]).not.toContain('секретный текст')
  })

  it('sends quotedMessageId only for a reply in the same chat', async () => {
    setReply('10000000', reply)
    let sent: { chatId: string; quotedMessageId?: string } | null = null
    await sendChatMessage('10000000', 'ответ', {
      createId: () => 'local-1',
      client: {
        sendMessage: (params) => {
          sent = {
            chatId: params.chatId,
            quotedMessageId: params.quotedMessageId,
          }
          return Promise.resolve({ idMessage: 'provider-1' })
        },
      },
    })

    expect(sent).toEqual({
      chatId: '10000000',
      quotedMessageId: '116413118178426437',
    })
    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      text: 'ответ',
      quote: {
        sourceId: '116413118178426437',
        excerpt: 'исходный текст',
        authorName: 'Вы',
      },
    })
    expect(selectReply('10000000')(useDraftStore.getState())).toBeNull()
  })

  it('does not send when the selected reply has no provider id', async () => {
    setDraft('10000000', 'ответ')
    setReply('10000000', { ...reply, providerId: '   ' })
    let calls = 0
    const outcome = await sendChatMessage('10000000', 'ответ', {
      client: {
        sendMessage: () => {
          calls += 1
          return Promise.resolve({ idMessage: 'provider-1' })
        },
      },
    })

    expect(outcome).toEqual({
      status: 'invalid',
      message: 'Нельзя ответить на это сообщение.',
    })
    expect(calls).toBe(0)
    expect(selectDraft('10000000')(useDraftStore.getState())).toBe('ответ')
    expect(selectReply('10000000')(useDraftStore.getState())?.providerId).toBe(
      '   ',
    )
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toBe(
      undefined,
    )
  })

  it('keeps a newer draft and reply when the request finishes later', async () => {
    const pending = deferred<SendMessageResult>()
    setDraft('10000000', 'hello')
    setReply('10000000', reply)
    const request = sendChatMessage('10000000', 'hello', {
      createId: () => 'local-1',
      client: { sendMessage: () => pending.promise },
    })
    setDraft('10000000', 'next line')
    setReply('10000000', {
      ...reply,
      providerId: 'new-quote',
      excerpt: 'новое',
    })
    pending.resolve({ idMessage: 'provider-1' })
    await request

    expect(selectDraft('10000000')(useDraftStore.getState())).toBe('next line')
    expect(selectReply('10000000')(useDraftStore.getState())).toMatchObject({
      providerId: 'new-quote',
      excerpt: 'новое',
    })
    expect(
      useMessageStore.getState().messagesById['local-1']?.quote,
    ).toMatchObject({
      sourceId: '116413118178426437',
      excerpt: 'исходный текст',
    })
  })

  it('keeps replies with their chats and clears them on logout', () => {
    setDraft('10000000', 'one')
    setReply('10000000', reply)
    setDraft('20000000', 'two')
    setReply('20000000', {
      ...reply,
      chatId: '20000000',
      providerId: 'other',
      excerpt: 'другой',
    })

    expect(selectDraft('10000000')(useDraftStore.getState())).toBe('one')
    expect(selectReply('10000000')(useDraftStore.getState())?.excerpt).toBe(
      'исходный текст',
    )
    expect(selectDraft('20000000')(useDraftStore.getState())).toBe('two')
    expect(selectReply('20000000')(useDraftStore.getState())?.providerId).toBe(
      'other',
    )

    clearDrafts()
    expect(selectDraft('10000000')(useDraftStore.getState())).toBe('')
    expect(selectReply('10000000')(useDraftStore.getState())).toBeNull()
    expect(selectReply('20000000')(useDraftStore.getState())).toBeNull()
  })

  it('retries a failed or unknown reply with the original quote', async () => {
    setReply('10000000', reply)
    const sent: Array<string | undefined> = []
    await sendChatMessage('10000000', 'ответ', {
      createId: () => 'local-1',
      client: {
        sendMessage: (params) => {
          sent.push(params.quotedMessageId)
          return Promise.reject(
            new GreenApiError('http', 'rejected', { status: 400 }),
          )
        },
      },
    })

    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      sendState: 'failed',
      quote: { sourceId: '116413118178426437' },
    })

    await retryChatMessage('local-1', false, {
      client: {
        sendMessage: (params) => {
          sent.push(params.quotedMessageId)
          return Promise.reject(new GreenApiError('timeout', 'timed out'))
        },
      },
    })
    expect(useMessageStore.getState().messagesById['local-1']?.sendState).toBe(
      'unknown',
    )

    const confirm = await retryChatMessage('local-1')
    expect(confirm).toEqual({ status: 'confirm' })
    await retryChatMessage('local-1', true, {
      client: {
        sendMessage: (params) => {
          sent.push(params.quotedMessageId)
          return Promise.resolve({ idMessage: 'provider-2' })
        },
      },
    })

    expect(sent).toEqual([
      '116413118178426437',
      '116413118178426437',
      '116413118178426437',
    ])
    expect(
      useMessageStore.getState().messagesById['local-1']?.quote?.excerpt,
    ).toBe('исходный текст')
  })
})

const reply = {
  providerId: '116413118178426437',
  chatId: '10000000',
  composerLabel: 'Ответ для вас',
  bubbleAuthor: 'Вы',
  excerpt: 'исходный текст',
}

function toastTexts(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message)
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => {
    throw new Error('deferred resolve is not ready')
  }
  let rejectPromise: (error: unknown) => void = () => {
    throw new Error('deferred reject is not ready')
  }
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  return {
    promise,
    resolve: (value: T) => {
      resolvePromise(value)
    },
    reject: (error: unknown) => {
      rejectPromise(error)
    },
  }
}
