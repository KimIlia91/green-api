import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetChats, upsertChat, useChatStore } from '@/entities/chat'
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
  cancelPendingDeletes,
  deleteBlockReason,
  deleteMessages,
  deleteUnconfirmedMessage,
} from '@/features/delete-messages/model/delete-messages.ts'

const sentAt = 1_700_000_000_000

function message(patch: Partial<Message>): Message {
  return {
    localId: 'local-1',
    providerId: 'provider-1',
    chatId: '10000000',
    text: 'Привет',
    stickerUrl: null,
    stickerMimeType: null,
    direction: 'outgoing',
    createdAt: sentAt,
    sentAt,
    sendState: 'read',
    errorText: null,
    ...patch,
  }
}

describe('deleteMessages', () => {
  beforeEach(() => {
    resetToastStore()
    cancelPendingDeletes()
    resetMessages()
    resetChats()
    upsertChat({
      chatId: '10000000',
      phoneNumber: null,
      name: null,
      username: null,
      preview: 'Привет',
      lastActivityAt: sentAt,
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

  it('blocks the whole selection when one message cannot be deleted', async () => {
    const outgoing = message({ localId: 'local-1' })
    const incoming = message({
      localId: 'local-2',
      providerId: 'provider-2',
      direction: 'incoming',
      text: 'Чужое',
    })
    addMessage(outgoing)
    addMessage(incoming)

    expect(deleteBlockReason([outgoing, incoming])).toMatch(/только свои/)
    const deleteMessage = vi.fn()
    const outcome = await deleteMessages(['local-1', 'local-2'], {
      client: { deleteMessage },
    })

    expect(deleteMessage).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toEqual([])
    expect(outcome.deleted).toEqual([])
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
      'local-2',
    ])
  })

  it('deletes an edited message by the original provider id', async () => {
    addMessage(
      message({
        edited: true,
        providerId: 'original-id',
      }),
    )
    const deleteMessage = vi
      .fn<GreenApiClient['deleteMessage']>()
      .mockResolvedValue(undefined)

    const outcome = await deleteMessages(['local-1'], {
      client: { deleteMessage },
    })

    expect(deleteBlockReason([message({ edited: true })])).toBeNull()
    expect(deleteMessage.mock.calls[0]?.[0]).toEqual({
      chatId: '10000000',
      idMessage: 'original-id',
      onlySenderDelete: false,
    })
    expect(deleteMessage.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(outcome.deleted).toEqual(['local-1'])
    expect(outcome.message).toBe('Сообщение удалено.')
    expect(useToastStore.getState().toasts).toEqual([])
    expect(useMessageStore.getState().messagesById['local-1']).toBeUndefined()
  })

  it('deletes allowed messages one by one and keeps the failed id selected in the result', async () => {
    addMessage(message({ localId: 'local-1', providerId: 'provider-1' }))
    addMessage(
      message({
        localId: 'local-2',
        providerId: 'provider-2',
        text: 'Второе',
        createdAt: sentAt + 1_000,
      }),
    )
    const deleteMessage = vi
      .fn<GreenApiClient['deleteMessage']>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new GreenApiError('http', 'bad', { status: 400 }))

    const outcome = await deleteMessages(['local-1', 'local-2'], {
      client: { deleteMessage },
    })

    expect(deleteMessage.mock.calls[0]?.[0]).toEqual({
      chatId: '10000000',
      idMessage: 'provider-1',
      onlySenderDelete: false,
    })
    expect(deleteMessage.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(deleteMessage.mock.calls[1]?.[0]).toEqual({
      chatId: '10000000',
      idMessage: 'provider-2',
      onlySenderDelete: false,
    })
    expect(deleteMessage.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(deleteMessage).toHaveBeenCalledTimes(2)
    expect(outcome.deleted).toEqual(['local-1'])
    expect(outcome.failed).toEqual(['local-2'])
    expect(outcome.uncertain).toEqual([])
    expect(outcome.message).toBe('')
    expect(toastTexts()).toEqual(['Удалено 1. Не удалось удалить 1.'])
    expect(useMessageStore.getState().messagesById['local-1']).toBeUndefined()
    expect(useMessageStore.getState().messagesById['local-2']?.text).toBe(
      'Второе',
    )
    expect(useChatStore.getState().chatsById['10000000']?.preview).toBe(
      'Второе',
    )
  })

  it('shows one toast for one refused delete and does not remove the message', async () => {
    addMessage(message({ text: 'Секретный текст' }))
    const deleteMessage = vi
      .fn()
      .mockRejectedValue(new GreenApiError('http', 'bad', { status: 400 }))

    const outcome = await deleteMessages(['local-1'], {
      client: { deleteMessage },
    })

    expect(deleteMessage).toHaveBeenCalledOnce()
    expect(outcome).toMatchObject({
      deleted: [],
      failed: ['local-1'],
      uncertain: [],
      message: '',
    })
    expect(toastTexts()).toEqual(['Не удалось удалить сообщение.'])
    expect(toastTexts()[0]).not.toContain('Секретный текст')
    expect(useMessageStore.getState().messagesById['local-1']?.text).toBe(
      'Секретный текст',
    )
  })

  it('names a timeout as unconfirmed and keeps the message', async () => {
    addMessage(message({}))
    const outcome = await deleteMessages(['local-1'], {
      client: {
        deleteMessage: () =>
          Promise.reject(new GreenApiError('timeout', 'timed out')),
      },
    })

    expect(outcome).toMatchObject({
      deleted: [],
      failed: [],
      uncertain: ['local-1'],
      message: '',
    })
    expect(toastTexts()).toEqual([deleteUnconfirmedMessage])
    expect(deleteUnconfirmedMessage).not.toBe('Не удалось удалить сообщение.')
    expect(useMessageStore.getState().messagesById['local-1']).toBeDefined()
  })

  it('classifies HTTP 466 and stops the rest of a bulk delete', async () => {
    addMessage(message({ localId: 'local-1', providerId: 'provider-1' }))
    addMessage(
      message({
        localId: 'local-2',
        providerId: 'provider-2',
        createdAt: sentAt + 1_000,
      }),
    )
    addMessage(
      message({
        localId: 'local-3',
        providerId: 'provider-3',
        createdAt: sentAt + 2_000,
      }),
    )
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
      'Превышена квота метода удаления.',
      'Превышена квота чатов и метода удаления.',
      'Сработало ограничение тарифа.',
      'Сработало ограничение тарифа.',
    ]

    for (const [index, body] of bodies.entries()) {
      resetMessages()
      resetToastStore()
      addMessage(message({ text: 'Секрет' }))
      const outcome = await deleteMessages(['local-1'], {
        client: {
          deleteMessage: () =>
            Promise.reject(
              new GreenApiError('http', 'quota', {
                status: 466,
                responseBody: body,
              }),
            ),
        },
      })

      expect(outcome.failed).toEqual(['local-1'])
      expect(outcome.deleted).toEqual([])
      expect(toastTexts()).toEqual([notices[index]])
      expect(notices[index]).not.toMatch(/https|abc123|Секрет/)
      if (index === 1 || index >= 3) {
        expect(notices[index]).not.toMatch(/чат/)
      }
      expect(useMessageStore.getState().messagesById['local-1']).toBeDefined()
    }

    resetMessages()
    resetToastStore()
    addMessage(message({ localId: 'local-1', providerId: 'provider-1' }))
    addMessage(
      message({
        localId: 'local-2',
        providerId: 'provider-2',
        createdAt: sentAt + 1_000,
      }),
    )
    addMessage(
      message({
        localId: 'local-3',
        providerId: 'provider-3',
        createdAt: sentAt + 2_000,
      }),
    )
    const deleteMessage = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new GreenApiError('http', 'quota', {
          status: 466,
          responseBody: { invokeStatus: { status: 'QUOTA_EXCEEDED' } },
        }),
      )
    const outcome = await deleteMessages(['local-1', 'local-2', 'local-3'], {
      client: { deleteMessage },
    })

    expect(deleteMessage).toHaveBeenCalledTimes(2)
    expect(outcome.deleted).toEqual(['local-1'])
    expect(outcome.failed).toEqual(['local-2'])
    expect(outcome.uncertain).toEqual([])
    expect(useMessageStore.getState().messagesById['local-1']).toBeUndefined()
    expect(useMessageStore.getState().messagesById['local-2']).toBeDefined()
    expect(useMessageStore.getState().messagesById['local-3']).toBeDefined()
    expect(toastTexts()).toEqual([
      'Удалено 1. Не удалось удалить 1. Превышена квота метода удаления.',
    ])
  })

  it('does not toast a delete cancelled with the session or after leave starts', async () => {
    addMessage(message({}))
    const cancelled = deferred<void>()
    const cancelRequest = deleteMessages(['local-1'], {
      client: { deleteMessage: () => cancelled.promise },
    })
    cancelPendingDeletes()
    cancelled.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await expect(cancelRequest).resolves.toMatchObject({
      deleted: [],
      failed: [],
      message: '',
    })
    expect(useToastStore.getState().toasts).toEqual([])
    expect(useMessageStore.getState().messagesById['local-1']).toBeDefined()

    const late = deferred<void>()
    const lateRequest = deleteMessages(['local-1'], {
      client: { deleteMessage: () => late.promise },
    })
    clearSession()
    late.resolve()
    await expect(lateRequest).resolves.toMatchObject({
      deleted: [],
      message: '',
    })
    expect(useToastStore.getState().toasts).toEqual([])
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
