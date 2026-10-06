import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetChats, upsertChat } from '@/entities/chat'
import {
  addMessage,
  resetMessages,
  useMessageStore,
  type Message,
} from '@/entities/message'
import { clearSession, useSessionStore } from '@/entities/session'
import { GreenApiError, type GreenApiClient } from '@/shared/api'
import { resetToastStore, useToastStore } from '@/shared/lib/toast'

import {
  cancelPendingForwards,
  forwardBlockReason,
  forwardFollowUp,
  forwardSelectedMessages,
  forwardUnconfirmedMessage,
  unknownForwardMessage,
} from '@/features/forward-messages/model/forward-messages.ts'

function message(patch: Partial<Message>): Message {
  return {
    localId: 'local-1',
    providerId: 'provider-1',
    chatId: '10000000',
    text: 'Привет',
    stickerUrl: null,
    stickerMimeType: null,
    direction: 'incoming',
    createdAt: 1_700_000_000_000,
    sentAt: 1_700_000_000_000,
    sendState: null,
    errorText: null,
    originName: 'Анна',
    ...patch,
  }
}

describe('forwardSelectedMessages', () => {
  beforeEach(() => {
    resetToastStore()
    cancelPendingForwards()
    resetMessages()
    resetChats()
    upsertChat({
      chatId: '10000000',
      name: 'Анна',
      username: null,
      phoneNumber: null,
    })
    useSessionStore.setState({
      connection: {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      stateInstance: 'authorized',
    })
  })

  it('sends provider ids in the given thread order and does not copy them onto the response', async () => {
    addMessage(message({ localId: 'local-1', providerId: 'provider-1' }))
    addMessage(
      message({
        localId: 'local-2',
        providerId: 'provider-2',
        text: 'Дальше',
        createdAt: 1_700_000_001_000,
      }),
    )
    const forwardMessages = vi
      .fn<GreenApiClient['forwardMessages']>()
      .mockResolvedValue({
        messages: ['queued-9'],
      })

    const outcome = await forwardSelectedMessages(
      ['local-1', 'local-2'],
      '20000000',
      { client: { forwardMessages } },
    )

    expect(outcome).toEqual({ status: 'queued' })
    expect(forwardFollowUp(outcome)).toEqual({
      closeTarget: true,
      clearSelection: true,
      notice: '',
      confirm: null,
    })
    expect(useToastStore.getState().toasts).toEqual([])
    expect(forwardMessages.mock.calls[0]?.[0]).toEqual({
      chatId: '20000000',
      chatIdFrom: '10000000',
      messages: ['provider-1', 'provider-2'],
    })
    expect(forwardMessages.mock.calls[0]?.[1]?.signal).toBeInstanceOf(
      AbortSignal,
    )
    expect(useMessageStore.getState().localIdByProviderId['queued-9']).toBe(
      undefined,
    )
    expect(useMessageStore.getState().messagesById['local-1']?.originName).toBe(
      'Анна',
    )
  })

  it('does not replace a forwarded message author with the current contact', async () => {
    addMessage(
      message({
        forwarded: true,
        originName: null,
        direction: 'incoming',
      }),
    )
    const forwardMessages = vi
      .fn()
      .mockResolvedValue({ messages: ['queued-1'] })

    await forwardSelectedMessages(['local-1'], '20000000', {
      client: { forwardMessages },
    })

    expect(useMessageStore.getState().messagesById['local-1']?.originName).toBe(
      null,
    )
  })

  it('keeps an already forwarded author and does not retry after an unknown result', async () => {
    addMessage(message({ forwarded: true, originName: 'Анна' }))
    const forwardMessages = vi
      .fn()
      .mockRejectedValueOnce(new GreenApiError('timeout', 'timed out'))
      .mockRejectedValueOnce(new GreenApiError('network', 'offline'))

    const outcome = await forwardSelectedMessages(['local-1'], '20000000', {
      client: { forwardMessages },
    })
    const repeat = await forwardSelectedMessages(['local-1'], '20000000', {
      client: { forwardMessages },
    })

    expect(outcome).toEqual({
      status: 'unknown',
      message: unknownForwardMessage,
    })
    expect(forwardFollowUp(outcome)).toMatchObject({
      closeTarget: false,
      clearSelection: false,
      confirm: unknownForwardMessage,
    })
    expect(repeat).toEqual({
      status: 'confirm',
      message: unknownForwardMessage,
    })
    expect(forwardMessages).toHaveBeenCalledOnce()
    expect(toastTexts()).toEqual([forwardUnconfirmedMessage])
    expect(forwardUnconfirmedMessage).not.toBe('Не удалось переслать сообщения')
    expect(useMessageStore.getState().messagesById['local-1']?.originName).toBe(
      'Анна',
    )

    const acknowledged = await forwardSelectedMessages(
      ['local-1'],
      '20000000',
      { client: { forwardMessages }, acknowledgeUnknown: true },
    )
    expect(acknowledged.status).toBe('unknown')
    expect(forwardMessages).toHaveBeenCalledTimes(2)
    expect(toastTexts()).toEqual([
      forwardUnconfirmedMessage,
      forwardUnconfirmedMessage,
    ])
  })

  it('shows one refusal toast and keeps the selection available for retry', async () => {
    addMessage(message({ text: 'Секретный текст' }))
    const forwardMessages = vi
      .fn<GreenApiClient['forwardMessages']>()
      .mockRejectedValue(new GreenApiError('http', 'bad', { status: 400 }))

    const outcome = await forwardSelectedMessages(['local-1'], '20000000', {
      client: { forwardMessages },
    })

    expect(outcome).toEqual({ status: 'rejected', message: '' })
    expect(toastTexts()).toEqual(['Не удалось переслать сообщения'])

    const retry = await forwardSelectedMessages(['local-1'], '20000000', {
      client: { forwardMessages },
    })

    expect(forwardFollowUp(outcome)).toEqual({
      closeTarget: false,
      clearSelection: false,
      notice: '',
      confirm: null,
    })
    expect(retry.status).toBe('rejected')
    expect(forwardMessages).toHaveBeenCalledTimes(2)
    expect(toastTexts()).toEqual([
      'Не удалось переслать сообщения',
      'Не удалось переслать сообщения',
    ])
    expect(toastTexts()[0]).not.toContain('Секретный текст')
    expect(useMessageStore.getState().messagesById['local-1']?.text).toBe(
      'Секретный текст',
    )
  })

  it('classifies HTTP 466 without calling every body a chat quota', async () => {
    const bodies = [
      {
        invokeStatus: {
          status: 'QUOTE_ALLOWED',
          description: 'https://console.green-api.com token abc123',
        },
        correspondentsStatus: { status: 'CORRESPONDENTS_QUOTA_EXCEEDED' },
      },
      {
        invokeStatus: { status: 'QUOTE_EXCEEDED' },
        quotaData: { status: 'QUOTE_ALLOWED' },
      },
      {
        invokeStatus: { status: 'QUOTA_EXCEEDED' },
        correspondentsStatus: { status: 'CORRESPONDENTS_QUOTA_EXCEEDED' },
      },
      { invokeStatus: { status: 'QUOTE_ALLOWED' } },
      null,
    ]
    const notices = [
      'Превышена квота чатов тарифа.',
      'Превышена квота метода пересылки.',
      'Превышена квота чатов и метода пересылки.',
      'Сработало ограничение тарифа.',
      'Сработало ограничение тарифа.',
    ]

    addMessage(message({ text: 'Секрет' }))

    for (const [index, body] of bodies.entries()) {
      resetToastStore()
      cancelPendingForwards()
      const outcome = await forwardSelectedMessages(['local-1'], '20000000', {
        client: {
          forwardMessages: () =>
            Promise.reject(
              new GreenApiError('http', 'quota', {
                status: 466,
                responseBody: body,
              }),
            ),
        },
      })

      expect(outcome).toEqual({ status: 'rejected', message: '' })
      expect(forwardFollowUp(outcome).clearSelection).toBe(false)
      expect(toastTexts()).toEqual([notices[index]])
      expect(notices[index]).not.toMatch(/https|abc123|Секрет/)
      if (index === 1 || index >= 3) {
        expect(notices[index]).not.toMatch(/чат/)
      }
    }
  })

  it('does not toast a forward cancelled with the session or after leave starts', async () => {
    addMessage(message({}))
    const cancelled = deferred<{ messages: string[] }>()
    const cancelRequest = forwardSelectedMessages(['local-1'], '20000000', {
      client: { forwardMessages: () => cancelled.promise },
    })
    cancelPendingForwards()
    cancelled.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await expect(cancelRequest).resolves.toEqual({ status: 'ignored' })
    expect(useToastStore.getState().toasts).toEqual([])
    expect(useMessageStore.getState().messagesById['local-1']).toBeDefined()

    const late = deferred<{ messages: string[] }>()
    const lateRequest = forwardSelectedMessages(['local-1'], '20000000', {
      client: { forwardMessages: () => late.promise },
    })
    clearSession()
    late.resolve({ messages: ['queued-9'] })
    await expect(lateRequest).resolves.toEqual({ status: 'ignored' })
    expect(useToastStore.getState().toasts).toEqual([])
    expect(useMessageStore.getState().localIdByProviderId['queued-9']).toBe(
      undefined,
    )
    expect(useMessageStore.getState().messagesById['local-1']).toBeDefined()
  })

  it('blocks a message that has no provider id', async () => {
    addMessage(message({ providerId: null }))
    const forwardMessages = vi.fn<GreenApiClient['forwardMessages']>()

    const outcome = await forwardSelectedMessages(['local-1'], '20000000', {
      client: { forwardMessages },
    })

    expect(forwardBlockReason([message({ providerId: null })])).toMatch(
      /идентификатора/,
    )
    expect(forwardMessages).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toEqual([])
    expect(forwardFollowUp(outcome).clearSelection).toBe(false)
    expect(useMessageStore.getState().messagesById['local-1']).toBeDefined()
  })
})

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
