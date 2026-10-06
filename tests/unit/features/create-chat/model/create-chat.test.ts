import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetChats, useChatStore } from '@/entities/chat'
import {
  clearSession,
  establishSession,
  useSessionStore,
} from '@/entities/session'
import {
  GreenApiError,
  type CheckAccountResult,
  type GetContactInfoResult,
} from '@/shared/api'
import { resetToastStore, useToastStore } from '@/shared/lib/toast'

import {
  accountMissingMessage,
  cancelChatProfiles,
  checkAccountFailureMessage,
  createChatFromPhone,
} from '@/features/create-chat/model/create-chat.ts'
import { normalizePhone } from '@/features/create-chat/model/phone.ts'
import { createSubmitGate } from '@/features/create-chat/model/submit-gate.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('normalizePhone', () => {
  it('accepts the same number with and without a leading plus', () => {
    const samples = [
      ['+996 700 123 456', '996700123456'],
      ['996700123456', '996700123456'],
      ['+7 (999) 123-45-67', '79991234567'],
      ['7 (999) 123-45-67', '79991234567'],
      ['+375 29 123-45-67', '375291234567'],
      ['375 29 123-45-67', '375291234567'],
      ['+1 (202) 555-0123', '12025550123'],
      ['12025550123', '12025550123'],
      ['+44 7911 123456', '447911123456'],
      ['447911123456', '447911123456'],
    ] as const

    for (const [raw, digits] of samples) {
      expect(normalizePhone(raw)).toEqual({ ok: true, digits })
    }
  })

  it('does not strip other unexpected characters', () => {
    expect(normalizePhone('7 999 123 45 67!').ok).toBe(false)
    expect(normalizePhone('++79991234567').ok).toBe(false)
    expect(normalizePhone('7999abc1234').ok).toBe(false)
    expect(normalizePhone('996.700.123456').ok).toBe(false)
  })

  it('rejects a local number and lengths outside 7 to 15 digits', () => {
    expect(normalizePhone('0700123456')).toEqual({
      ok: false,
      issue: 'invalid-format',
    })
    expect(normalizePhone('0123456')).toEqual({
      ok: false,
      issue: 'invalid-format',
    })
    expect(normalizePhone('123456')).toEqual({
      ok: false,
      issue: 'invalid-format',
    })
    expect(normalizePhone('1234567')).toEqual({
      ok: true,
      digits: '1234567',
    })
    expect(normalizePhone('+123456789012345')).toEqual({
      ok: true,
      digits: '123456789012345',
    })
    expect(normalizePhone('1234567890123456')).toEqual({
      ok: false,
      issue: 'invalid-format',
    })
  })
})

describe('createChatFromPhone', () => {
  beforeEach(() => {
    resetToastStore()
    cancelChatProfiles()
    clearSession()
    resetChats()
    establishSession(connection, 'authorized')
  })

  it('creates a chat when the account exists', async () => {
    const controller = new AbortController()
    const checkAccount = vi.fn((): Promise<CheckAccountResult> =>
      Promise.resolve({
        exist: true,
        chatId: '10000000',
        fromCache: false,
      }),
    )

    const outcome = await createChatFromPhone({
      rawPhone: '+7 (999) 123-45-67',
      signal: controller.signal,
      isStale: () => false,
      client: { checkAccount },
    })

    expect(outcome).toEqual({ status: 'created', chatId: '10000000' })
    expect(checkAccount).toHaveBeenCalledWith(
      { phoneNumber: 79991234567 },
      { signal: controller.signal },
    )
    expect(useChatStore.getState().chatIds).toEqual(['10000000'])
    expect(useChatStore.getState().activeChatId).toBeNull()
    expect(useChatStore.getState().chatsById['10000000']).toEqual({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: null,
      username: null,
      preview: null,
      previewForwarded: false,
      lastActivityAt: null,
      unseenIncomingIds: [],
    })
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('does not duplicate an existing chat id', async () => {
    const client = {
      checkAccount: () =>
        Promise.resolve({
          exist: true,
          chatId: '10000000',
          fromCache: true,
        }),
    }

    await createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => false,
      client,
    })
    await createChatFromPhone({
      rawPhone: '79990000000',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () =>
          Promise.resolve({
            exist: true,
            chatId: '10000000',
            fromCache: false,
          }),
      },
    })

    expect(useChatStore.getState().chatIds).toEqual(['10000000'])
    expect(useChatStore.getState().chatsById['10000000']?.phoneNumber).toBe(
      '79990000000',
    )
  })

  it('sends digits without a plus for numbers with and without one', async () => {
    const phoneNumbers: number[] = []
    const checkAccount = vi.fn(
      (params: { phoneNumber: number }): Promise<CheckAccountResult> => {
        phoneNumbers.push(params.phoneNumber)
        return Promise.resolve({
          exist: true,
          chatId: '10000000',
          fromCache: false,
        })
      },
    )

    for (const rawPhone of ['+996 700 123 456', '996700123456']) {
      resetChats()
      await createChatFromPhone({
        rawPhone,
        signal: new AbortController().signal,
        isStale: () => false,
        client: { checkAccount },
      })
    }

    expect(phoneNumbers).toEqual([996700123456, 996700123456])
    expect(useChatStore.getState().chatsById['10000000']?.phoneNumber).toBe(
      '996700123456',
    )
  })

  it('does not call CheckAccount for a local or otherwise invalid number', async () => {
    const checkAccount = vi.fn()
    const outcome = await createChatFromPhone({
      rawPhone: '0700123456',
      signal: new AbortController().signal,
      isStale: () => false,
      client: { checkAccount },
    })

    expect(outcome).toEqual({
      status: 'invalid',
      message:
        'Введите номер в международном формате: от 7 до 15 цифр, без ведущего нуля.',
    })
    expect(checkAccount).not.toHaveBeenCalled()
    expect(useChatStore.getState().chatIds).toEqual([])
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('keeps a missing connection next to the field', async () => {
    clearSession()
    const checkAccount = vi.fn()
    const outcome = await createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => false,
      client: { checkAccount },
    })

    expect(outcome).toEqual({
      status: 'rejected',
      message: 'Подключение не найдено.',
    })
    expect(checkAccount).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('does not create a chat when the account is missing', async () => {
    const outcome = await createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () =>
          Promise.resolve({
            exist: false,
            chatId: '',
            fromCache: false,
          }),
      },
    })

    expect(outcome).toEqual({
      status: 'rejected',
      message: accountMissingMessage,
    })
    expect(useChatStore.getState().chatIds).toEqual([])
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('does not create a chat when CheckAccount returns status false', async () => {
    const outcome = await createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () =>
          Promise.resolve({
            status: false,
            reason: 'instance is starting or not authorized',
          }),
      },
    })

    expect(outcome).toEqual({ status: 'rejected', message: '' })
    expect(toastTexts()).toEqual([checkAccountFailureMessage])
    expect(toastTexts()[0]).not.toContain('instance is starting')
    expect(useChatStore.getState().chatIds).toEqual([])
  })

  it('toasts when CheckAccount returns an empty chat id', async () => {
    const outcome = await createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () =>
          Promise.resolve({
            exist: true,
            chatId: '   ',
            fromCache: false,
          }),
      },
    })

    expect(outcome).toEqual({ status: 'rejected', message: '' })
    expect(toastTexts()).toEqual([checkAccountFailureMessage])
    expect(useChatStore.getState().chatIds).toEqual([])
  })

  it('does not treat a provider phone restriction as a missing account', async () => {
    const outcome = await createChatFromPhone({
      rawPhone: '+996 700 123 456',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () =>
          Promise.reject(
            new GreenApiError(
              'invalid-request',
              'phoneNumber must be an integer of 7 to 15 digits',
            ),
          ),
      },
    })

    expect(outcome).toEqual({ status: 'rejected', message: '' })
    expect(toastTexts()).toEqual([checkAccountFailureMessage])
    expect(toastTexts()[0]).not.toBe(accountMissingMessage)
    expect(useChatStore.getState().chatIds).toEqual([])
  })

  it('does not treat an HTTP format rejection as a missing account', async () => {
    const outcome = await createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () =>
          Promise.reject(
            new GreenApiError('http', 'validation failed', { status: 400 }),
          ),
      },
    })

    expect(outcome).toEqual({ status: 'rejected', message: '' })
    expect(toastTexts()).toEqual([checkAccountFailureMessage])
    expect(toastTexts()[0]).not.toBe(accountMissingMessage)
    expect(useChatStore.getState().chatIds).toEqual([])
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
      'Превышена квота метода проверки аккаунта.',
      'Превышена квота чатов и метода проверки аккаунта.',
      'Сработало ограничение тарифа.',
      'Сработало ограничение тарифа.',
    ]

    for (const [index, body] of bodies.entries()) {
      resetToastStore()
      const outcome = await createChatFromPhone({
        rawPhone: '79991234567',
        signal: new AbortController().signal,
        isStale: () => false,
        client: {
          checkAccount: () =>
            Promise.reject(
              new GreenApiError('http', 'quota', {
                status: 466,
                responseBody: body,
              }),
            ),
        },
      })

      expect(outcome).toEqual({ status: 'rejected', message: '' })
      expect(useChatStore.getState().chatIds).toEqual([])
      expect(toastTexts()).toEqual([notices[index]])
      expect(notices[index]).not.toMatch(/https|abc123|79991234567/)
      if (index === 1 || index >= 3) {
        expect(notices[index]).not.toMatch(/чат/)
      }
    }
  })

  it('does not create a chat after a request error', async () => {
    const outcome = await createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () =>
          Promise.reject(
            new GreenApiError('network', 'Network request failed'),
          ),
      },
    })

    expect(outcome).toEqual({ status: 'rejected', message: '' })
    expect(toastTexts()).toEqual([checkAccountFailureMessage])
    expect(useChatStore.getState().chatIds).toEqual([])

    const timeout = await createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () =>
          Promise.reject(new GreenApiError('timeout', 'timed out')),
      },
    })
    expect(timeout).toEqual({ status: 'rejected', message: '' })
    expect(toastTexts()).toEqual([
      checkAccountFailureMessage,
      checkAccountFailureMessage,
    ])
  })

  it('ignores a late response after disconnect', async () => {
    const pending = deferred<CheckAccountResult>()
    const request = createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => useSessionStore.getState().connection === null,
      client: {
        checkAccount: () => pending.promise,
      },
    })

    clearSession()
    resetChats()
    pending.resolve({
      exist: true,
      chatId: '10000000',
      fromCache: false,
    })

    await expect(request).resolves.toEqual({ status: 'ignored' })
    expect(useChatStore.getState().chatIds).toEqual([])
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('does not toast a check cancelled with the dialog or after leave starts', async () => {
    const controller = new AbortController()
    const cancelled = deferred<CheckAccountResult>()
    const cancelRequest = createChatFromPhone({
      rawPhone: '79991234567',
      signal: controller.signal,
      isStale: () => false,
      client: { checkAccount: () => cancelled.promise },
    })
    controller.abort()
    cancelled.reject(new GreenApiError('network', 'offline'))
    await expect(cancelRequest).resolves.toEqual({ status: 'ignored' })
    expect(useToastStore.getState().toasts).toEqual([])

    const late = deferred<CheckAccountResult>()
    const lateRequest = createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => useSessionStore.getState().connection === null,
      client: { checkAccount: () => late.promise },
    })
    clearSession()
    late.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await expect(lateRequest).resolves.toEqual({ status: 'ignored' })
    expect(useToastStore.getState().toasts).toEqual([])
    expect(useChatStore.getState().chatIds).toEqual([])
  })

  it('blocks a second submit while the request is in flight', async () => {
    const gate = createSubmitGate()
    const pending = deferred<CheckAccountResult>()
    expect(gate.tryEnter()).toBe(true)

    const request = createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () => pending.promise,
      },
    })

    expect(gate.tryEnter()).toBe(false)
    pending.resolve({
      exist: true,
      chatId: '10000000',
      fromCache: false,
    })
    await request
    gate.leave()

    expect(gate.tryEnter()).toBe(true)
  })

  it('keeps the chat when the profile request fails', async () => {
    const outcome = await createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () =>
          Promise.resolve({
            exist: true,
            chatId: '10000000',
            fromCache: false,
          }),
        getContactInfo: () =>
          Promise.reject(new GreenApiError('network', 'offline')),
      },
    })

    await Promise.resolve()

    expect(outcome).toEqual({ status: 'created', chatId: '10000000' })
    expect(useChatStore.getState().chatsById['10000000']).toEqual({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: null,
      username: null,
      preview: null,
      previewForwarded: false,
      lastActivityAt: null,
      unseenIncomingIds: [],
    })
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('fills the contact name without replacing a hidden phone', async () => {
    await createChatFromPhone({
      rawPhone: '+7 (999) 123-45-67',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () =>
          Promise.resolve({
            exist: true,
            chatId: '10000000',
            fromCache: false,
          }),
        getContactInfo: () =>
          Promise.resolve({
            chatId: '10000000',
            name: ' ',
            contactName: ' Анна ',
            phoneNumber: 0,
          }),
      },
    })

    await vi.waitFor(() => {
      expect(useChatStore.getState().chatsById['10000000']?.name).toBe('Анна')
    })
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      username: null,
      phoneNumber: '79991234567',
    })
  })

  it('ignores a profile response after the load is cancelled', async () => {
    const pending = deferred<GetContactInfoResult>()
    await createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () =>
          Promise.resolve({
            exist: true,
            chatId: '10000000',
            fromCache: false,
          }),
        getContactInfo: () => pending.promise,
      },
    })

    cancelChatProfiles()
    clearSession()
    resetChats()
    pending.resolve({
      chatId: '10000000',
      name: 'Анна',
      contactName: 'Анна',
      phoneNumber: 79991234567,
    })
    await pending.promise
    await Promise.resolve()

    expect(useChatStore.getState().chatsById['10000000']).toBeUndefined()
    expect(useToastStore.getState().toasts).toEqual([])
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
