import { beforeEach, describe, expect, it } from 'vitest'

import { resetChats, upsertChat, useChatStore } from '@/entities/chat'
import { resetMessages, useMessageStore } from '@/entities/message'
import {
  clearSession,
  establishSession,
  useSessionStore,
} from '@/entities/session'
import { GreenApiError, type ReceivedNotification } from '@/shared/api'

import {
  startReceiveLoop,
  stopReceiveLoop,
} from '@/features/receive-notifications/model/receive-loop.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('receive loop', () => {
  beforeEach(() => {
    stopReceiveLoop()
    resetMessages()
    resetChats()
    clearSession()
    establishSession(connection, 'authorized')
  })

  it('does not start a second loop for the same connection', async () => {
    let calls = 0
    const pending = deferred<ReceivedNotification | null>()
    startReceiveLoop({
      client: {
        receiveNotification: () => {
          calls += 1
          return pending.promise
        },
        deleteNotification: () => Promise.resolve({ result: true, reason: '' }),
      },
    })
    startReceiveLoop({
      client: {
        receiveNotification: () => {
          calls += 1
          return Promise.resolve(null)
        },
        deleteNotification: () => Promise.resolve({ result: true, reason: '' }),
      },
    })

    await Promise.resolve()
    expect(calls).toBe(1)
    stopReceiveLoop()
    pending.resolve(null)
  })

  it('aborts the in-flight receive and does not schedule another', async () => {
    let calls = 0
    let signal: AbortSignal | undefined
    startReceiveLoop({
      client: {
        receiveNotification: (options) => {
          calls += 1
          signal = options?.signal
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => {
              reject(new GreenApiError('abort', 'aborted'))
            })
          })
        },
        deleteNotification: () => Promise.resolve({ result: true, reason: '' }),
      },
    })

    await Promise.resolve()
    stopReceiveLoop()
    await Promise.resolve()

    expect(calls).toBe(1)
    expect(signal?.aborted).toBe(true)
  })

  it('deletes a notification after handling it and continues after an empty response', async () => {
    const deleted: number[] = []
    const responses: Array<ReceivedNotification | null> = [
      null,
      {
        receiptId: 12,
        body: {
          typeWebhook: 'outgoingMessageStatus',
          timestamp: 1_755_591_519,
          idMessage: 'missing',
          chatId: '10000000',
          status: 'delivered',
        },
      },
    ]
    let releaseNext: (() => void) | undefined
    startReceiveLoop({
      client: {
        receiveNotification: () => {
          const next = responses.shift()
          if (next === undefined) {
            return new Promise(() => {
              releaseNext = () => undefined
            })
          }
          return Promise.resolve(next)
        },
        deleteNotification: (receiptId) => {
          deleted.push(receiptId)
          return Promise.resolve({ result: true, reason: '' })
        },
      },
    })

    await viWait(deleted, 1)
    expect(deleted).toEqual([12])
    expect(useMessageStore.getState().messagesById).toEqual({})
    stopReceiveLoop()
    releaseNext?.()
  })

  it('backs off after a failed receive and resets the delay after success', async () => {
    const delays: number[] = []
    let step = 0
    const sleeps = deferred<void>()
    startReceiveLoop({
      retryInitialDelayMs: 1000,
      retryMaxDelayMs: 2500,
      sleep: (ms, signal) => {
        delays.push(ms)
        if (delays.length < 3) {
          return Promise.resolve()
        }
        return abortable(sleeps.promise, signal)
      },
      client: {
        receiveNotification: () => {
          step += 1
          if (step === 3) {
            return Promise.resolve(null)
          }
          return Promise.reject(new GreenApiError('network', 'offline'))
        },
        deleteNotification: () => Promise.resolve({ result: true, reason: '' }),
      },
    })

    await viWait(delays, 3)
    expect(delays).toEqual([1000, 2000, 1000])
    stopReceiveLoop()
    sleeps.resolve()
  })

  it('does not receive again after the session is cleared', async () => {
    let calls = 0
    let release: (() => void) | undefined
    startReceiveLoop({
      client: {
        receiveNotification: () => {
          calls += 1
          if (calls === 1) {
            return Promise.resolve(null)
          }
          return new Promise((resolve) => {
            release = () => {
              resolve(null)
            }
          })
        },
        deleteNotification: () => Promise.resolve({ result: true, reason: '' }),
      },
    })

    await viWaitCalls(() => calls, 2)
    clearSession()
    release?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(useSessionStore.getState().connection).toBeNull()
    expect(calls).toBe(2)
  })

  it('drops a notification that resolves after leave', async () => {
    upsertChat({
      chatId: '10000000',
      phoneNumber: null,
      name: 'Избранное',
      username: null,
    })
    const pending = deferred<ReceivedNotification | null>()
    let deleted = 0
    startReceiveLoop({
      createId: () => 'late-out',
      client: {
        receiveNotification: () => pending.promise,
        deleteNotification: () => {
          deleted += 1
          return Promise.resolve({ result: true, reason: '' })
        },
      },
    })

    await Promise.resolve()
    stopReceiveLoop()
    clearSession()
    pending.resolve({
      receiptId: 77,
      body: {
        typeWebhook: 'outgoingMessageReceived',
        timestamp: 1_755_591_519,
        idMessage: 'late-out-id',
        senderData: {
          chatId: '10000000',
          chatName: 'Избранное',
          chatType: 'user',
          senderPhoneNumber: null,
        },
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: { textMessage: 'после выхода' },
        },
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(useMessageStore.getState().messagesById['late-out']).toBeUndefined()
    expect(deleted).toBe(0)
  })

  it('keeps one message when DeleteNotification returns false and the notice repeats', async () => {
    upsertChat({
      chatId: '10000000',
      phoneNumber: null,
      name: 'Анна',
      username: null,
    })
    const notice = {
      receiptId: 41,
      body: {
        typeWebhook: 'incomingMessageReceived' as const,
        timestamp: 1_755_591_519,
        idMessage: 'incoming-repeat',
        senderData: { chatId: '10000000' },
        messageData: {
          typeMessage: 'textMessage' as const,
          textMessageData: { textMessage: 'ещё раз' },
        },
      },
    }
    const responses = [notice, notice]
    const delays: number[] = []
    let deleted = 0
    startReceiveLoop({
      createId: () => 'local-repeat',
      retryInitialDelayMs: 1000,
      retryMaxDelayMs: 2000,
      sleep: (ms) => {
        delays.push(ms)
        return Promise.resolve()
      },
      client: {
        receiveNotification: () => {
          const next = responses.shift()
          if (next === undefined) {
            return new Promise(() => undefined)
          }
          return Promise.resolve(next)
        },
        deleteNotification: () => {
          deleted += 1
          return Promise.resolve({ result: false, reason: 'not removed' })
        },
      },
    })

    await viWaitCalls(() => deleted, 2)
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-repeat',
    ])
    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual(['incoming-repeat'])
    expect(delays).toEqual([1000])
    stopReceiveLoop()
  })

  it('drops a late incoming notice after leave', async () => {
    upsertChat({
      chatId: '10000000',
      phoneNumber: null,
      name: 'Анна',
      username: null,
    })
    const pending = deferred<ReceivedNotification | null>()
    startReceiveLoop({
      createId: () => 'late-in',
      client: {
        receiveNotification: () => pending.promise,
        deleteNotification: () => Promise.resolve({ result: true, reason: '' }),
      },
    })

    await Promise.resolve()
    stopReceiveLoop()
    resetChats()
    clearSession()
    pending.resolve({
      receiptId: 88,
      body: {
        typeWebhook: 'incomingMessageReceived',
        timestamp: 1_755_591_519,
        idMessage: 'late-in-id',
        senderData: { chatId: '10000000' },
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: { textMessage: 'после выхода' },
        },
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(useMessageStore.getState().messagesById['late-in']).toBeUndefined()
    expect(useChatStore.getState().chatsById['10000000']).toBeUndefined()
  })
})

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new GreenApiError('abort', 'aborted'))
      return
    }
    signal.addEventListener(
      'abort',
      () => {
        reject(new GreenApiError('abort', 'aborted'))
      },
      { once: true },
    )
    promise.then(resolve, reject)
  })
}

async function viWait(values: unknown[], length: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (values.length >= length) {
      return
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  }
  throw new Error(`timed out waiting for ${String(length)} items`)
}

async function viWaitCalls(read: () => number, count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (read() >= count) {
      return
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  }
  throw new Error(`timed out waiting for ${String(count)} calls`)
}
