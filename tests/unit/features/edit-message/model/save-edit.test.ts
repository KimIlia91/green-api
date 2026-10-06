import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addMessage,
  editExpiredMessage,
  editWindowMs,
  resetMessages,
  useMessageStore,
  type Message,
} from '@/entities/message'
import { clearSession, useSessionStore } from '@/entities/session'
import { GreenApiError } from '@/shared/api'
import { resetToastStore, useToastStore } from '@/shared/lib/toast'

import {
  beginEdit,
  cancelEdit,
  setEditText,
  useEditStore,
} from '@/features/edit-message/model/edit-session.ts'
import {
  editRefusedMessage,
  editUnconfirmedMessage,
  saveEditedMessage,
} from '@/features/edit-message/model/save-edit.ts'

const sentAt = 1_700_000_000_000

const message: Message = {
  localId: 'local-1',
  providerId: 'provider-1',
  chatId: '10000000',
  text: 'Привет',
  stickerUrl: null,
  stickerMimeType: null,
  direction: 'outgoing',
  createdAt: sentAt,
  sentAt,
  sendState: 'sent',
  errorText: null,
}

describe('saveEditedMessage', () => {
  beforeEach(() => {
    resetToastStore()
    resetMessages()
    cancelEdit()
    useSessionStore.setState({
      connection: {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      stateInstance: 'authorized',
    })
    addMessage(message)
  })

  it('does not send when the window closes between the start of editing and save', async () => {
    expect(beginEdit(message, sentAt + editWindowMs - 1)).toBe(true)
    useEditStore.setState({
      session: {
        localId: message.localId,
        chatId: message.chatId,
        text: 'Черновик правки',
        preview: message.text,
        notice: '',
      },
    })
    const editMessage = vi.fn()

    const outcome = await saveEditedMessage(
      message.localId,
      'Черновик правки',
      {
        now: () => sentAt + editWindowMs,
        client: { editMessage },
      },
    )

    expect(outcome).toEqual({ status: 'expired', message: editExpiredMessage })
    expect(editMessage).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toEqual([])
    expect(useEditStore.getState().session).toMatchObject({
      text: 'Черновик правки',
      notice: editExpiredMessage,
    })
    expect(
      useMessageStore.getState().messagesById[message.localId]?.sentAt,
    ).toBe(sentAt)
  })

  it('keeps the preview from the moment editing started', () => {
    beginEdit(message, sentAt + 1_000)
    setEditText('Черновик правки')

    expect(useEditStore.getState().session).toMatchObject({
      text: 'Черновик правки',
      preview: 'Привет',
    })
  })

  it('keeps the original sentAt after a successful edit', async () => {
    const editMessage = vi.fn().mockResolvedValue({ idMessage: 'provider-1' })
    beginEdit(message, sentAt + 1_000)

    const outcome = await saveEditedMessage(message.localId, 'Новый текст', {
      now: () => sentAt + 1_000,
      client: { editMessage },
    })

    expect(outcome).toEqual({ status: 'saved' })
    expect(useToastStore.getState().toasts).toEqual([])
    const stored = useMessageStore.getState().messagesById[message.localId]
    expect(stored?.text).toBe('Новый текст')
    expect(stored?.edited).toBe(true)
    expect(stored?.sentAt).toBe(sentAt)
    expect(stored?.createdAt).toBe(sentAt)

    const later = await saveEditedMessage(message.localId, 'Ещё текст', {
      now: () => sentAt + editWindowMs,
      client: { editMessage },
    })
    expect(later.status).toBe('expired')
    expect(editMessage).toHaveBeenCalledOnce()
    expect(
      useMessageStore.getState().messagesById[message.localId]?.sentAt,
    ).toBe(sentAt)
  })

  it('reports HTTP 400 as a request refusal, not as an expired edit window', async () => {
    beginEdit(message, sentAt + 1_000)
    setEditText('Новый текст')
    const editMessage = vi
      .fn()
      .mockRejectedValue(new GreenApiError('http', 'bad', { status: 400 }))

    const outcome = await saveEditedMessage(message.localId, 'Новый текст', {
      now: () => sentAt + 1_000,
      client: { editMessage },
    })

    expect(outcome).toEqual({ status: 'refused', message: editRefusedMessage })
    if (outcome.status === 'refused') {
      expect(outcome.message).not.toBe(editExpiredMessage)
    }
    expect(editMessage).toHaveBeenCalledOnce()
    expect(useEditStore.getState().session).toMatchObject({
      text: 'Новый текст',
      notice: '',
    })
    expect(toastTexts()).toEqual([editRefusedMessage])
    expect(toastTexts()[0]).not.toContain('Новый текст')
    expect(useMessageStore.getState().messagesById[message.localId]?.text).toBe(
      'Привет',
    )
    expect(
      useMessageStore.getState().messagesById[message.localId]?.sentAt,
    ).toBe(sentAt)
  })

  it('classifies an HTTP 466 edit failure from the provider body', async () => {
    beginEdit(message, sentAt + 1_000)
    setEditText('Новый текст')
    const cases = [
      {
        body: {
          invokeStatus: {
            status: 'QUOTE_ALLOWED',
            description: 'https://console.green-api.com token abc123',
          },
          correspondentsStatus: { status: 'CORRESPONDENTS_QUOTA_EXCEEDED' },
        },
        message: 'Превышена квота чатов тарифа.',
      },
      {
        body: {
          invokeStatus: { status: 'QUOTE_EXCEEDED' },
          quotaData: { status: 'QUOTE_ALLOWED' },
        },
        message: 'Превышена квота метода редактирования.',
      },
      {
        body: {
          invokeStatus: { status: 'QUOTA_EXCEEDED' },
          quotaData: { status: 'CORRESPONDENTS_QUOTA_EXCEEDED' },
        },
        message: 'Превышена квота чатов и метода редактирования.',
      },
      {
        body: { invokeStatus: { status: 'QUOTE_ALLOWED' } },
        message: 'Сработало ограничение тарифа.',
      },
      {
        body: null,
        message: 'Сработало ограничение тарифа.',
      },
    ]

    for (const item of cases) {
      resetToastStore()
      const outcome = await saveEditedMessage(message.localId, 'Новый текст', {
        now: () => sentAt + 1_000,
        client: {
          editMessage: () =>
            Promise.reject(
              new GreenApiError('http', 'quota', {
                status: 466,
                responseBody: item.body,
              }),
            ),
        },
      })

      expect(outcome).toEqual({ status: 'refused', message: item.message })
      expect(toastTexts()).toEqual([item.message])
      expect(item.message).not.toMatch(/https|abc123|Новый текст|description/)
      expect(item.message).not.toBe(editExpiredMessage)
    }

    expect(useEditStore.getState().session).toMatchObject({
      text: 'Новый текст',
      notice: '',
    })
    expect(useMessageStore.getState().messagesById[message.localId]?.text).toBe(
      'Привет',
    )
  })

  it('keeps one toast for one failed attempt and a separate toast for the next attempt', async () => {
    beginEdit(message, sentAt + 1_000)
    setEditText('Новый текст')
    const editMessage = vi
      .fn()
      .mockRejectedValue(new GreenApiError('http', 'bad', { status: 403 }))

    await saveEditedMessage(message.localId, 'Новый текст', {
      now: () => sentAt + 1_000,
      client: { editMessage },
    })
    expect(toastTexts()).toEqual(['Отправка ограничена для этого аккаунта.'])

    await saveEditedMessage(message.localId, 'Новый текст', {
      now: () => sentAt + 1_000,
      client: { editMessage },
    })

    expect(editMessage).toHaveBeenCalledTimes(2)
    expect(toastTexts()).toEqual([
      'Отправка ограничена для этого аккаунта.',
      'Отправка ограничена для этого аккаунта.',
    ])
    expect(useEditStore.getState().session).toMatchObject({
      text: 'Новый текст',
      notice: '',
    })
  })

  it('names a timeout or a dropped connection as an unconfirmed save', async () => {
    beginEdit(message, sentAt + 1_000)
    setEditText('Новый текст')

    const timeout = await saveEditedMessage(message.localId, 'Новый текст', {
      now: () => sentAt + 1_000,
      client: {
        editMessage: () =>
          Promise.reject(new GreenApiError('timeout', 'timed out')),
      },
    })
    const dropped = await saveEditedMessage(message.localId, 'Новый текст', {
      now: () => sentAt + 1_000,
      client: {
        editMessage: () =>
          Promise.reject(new GreenApiError('network', 'offline')),
      },
    })

    expect(timeout).toEqual({
      status: 'refused',
      message: editUnconfirmedMessage,
    })
    expect(dropped).toEqual({
      status: 'refused',
      message: editUnconfirmedMessage,
    })
    expect(toastTexts()).toEqual([
      editUnconfirmedMessage,
      editUnconfirmedMessage,
    ])
    expect(useEditStore.getState().session).toMatchObject({
      text: 'Новый текст',
      notice: '',
    })
    expect(useMessageStore.getState().messagesById[message.localId]?.text).toBe(
      'Привет',
    )
  })

  it('leaves an empty draft beside the field and does not toast it', async () => {
    beginEdit(message, sentAt + 1_000)
    setEditText('   ')
    const editMessage = vi.fn()

    const outcome = await saveEditedMessage(message.localId, '   ', {
      now: () => sentAt + 1_000,
      client: { editMessage },
    })

    expect(outcome).toEqual({
      status: 'invalid',
      message: 'Введите текст сообщения.',
    })
    expect(editMessage).not.toHaveBeenCalled()
    expect(useEditStore.getState().session).toMatchObject({
      text: '   ',
      notice: 'Введите текст сообщения.',
    })
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('does not toast a refusal after cancel or a session change', async () => {
    beginEdit(message, sentAt + 1_000)
    setEditText('Новый текст')
    const cancelled = deferred<{ idMessage: string }>()
    const cancelRequest = saveEditedMessage(message.localId, 'Новый текст', {
      now: () => sentAt + 1_000,
      client: { editMessage: () => cancelled.promise },
    })
    cancelEdit()
    cancelled.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await expect(cancelRequest).resolves.toEqual({ status: 'ignored' })
    expect(useToastStore.getState().toasts).toEqual([])

    beginEdit(message, sentAt + 1_000)
    setEditText('Поздний текст')
    const finished = deferred<{ idMessage: string }>()
    const finishedRequest = saveEditedMessage(
      message.localId,
      'Поздний текст',
      {
        now: () => sentAt + 1_000,
        client: { editMessage: () => finished.promise },
      },
    )
    cancelEdit()
    finished.resolve({ idMessage: 'provider-1' })
    await expect(finishedRequest).resolves.toEqual({ status: 'ignored' })
    expect(useMessageStore.getState().messagesById[message.localId]?.text).toBe(
      'Привет',
    )
    expect(useToastStore.getState().toasts).toEqual([])

    beginEdit(message, sentAt + 1_000)
    setEditText('Новый текст')
    const late = deferred<{ idMessage: string }>()
    const lateRequest = saveEditedMessage(message.localId, 'Новый текст', {
      now: () => sentAt + 1_000,
      client: { editMessage: () => late.promise },
    })
    clearSession()
    late.reject(new GreenApiError('timeout', 'timed out'))
    await expect(lateRequest).resolves.toEqual({ status: 'ignored' })
    expect(useToastStore.getState().toasts).toEqual([])
    expect(useMessageStore.getState().messagesById[message.localId]?.text).toBe(
      'Привет',
    )
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
