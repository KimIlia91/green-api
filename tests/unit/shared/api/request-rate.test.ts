import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requestTimeouts } from '@/shared/config/index.ts'

import { createGreenApiClient } from '@/shared/api/client.ts'
import { GreenApiError } from '@/shared/api/errors.ts'
import {
  configureRequestRateClock,
  requestRateStorageKey,
  resetRequestRate,
  scheduleRequest,
} from '@/shared/api/request-rate.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

const historyRow = {
  type: 'outgoing',
  idMessage: 'provider-1',
  timestamp: 1_755_000_000,
  typeMessage: 'textMessage',
  chatId: '10000000',
  textMessage: 'Привет',
  statusMessage: 'sent',
}

describe('request rate', () => {
  beforeEach(() => {
    resetRequestRate()
  })

  afterEach(() => {
    resetRequestRate()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('spaces preview and full history fetches by at least one second', async () => {
    vi.useFakeTimers()
    const starts: number[] = []
    const counts: number[] = []
    const fetchImpl = historyFetch(starts, counts)
    const preview = createGreenApiClient(connection, { fetchImpl })
    const history = createGreenApiClient(
      { ...connection, apiTokenInstance: 'othertoken' },
      { fetchImpl },
    )

    const previewRequest = preview.getChatHistory({
      chatId: '10000000',
      count: 1,
    })
    const historyRequest = history.getChatHistory({
      chatId: '20000000',
      count: 100,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(counts).toEqual([1])
    await vi.advanceTimersByTimeAsync(1199)
    expect(counts).toEqual([1])
    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([previewRequest, historyRequest])

    expect(counts).toEqual([1, 100])
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(1200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not start overdue tasks together after a delayed timer', async () => {
    vi.useFakeTimers()
    let now = 0
    configureRequestRateClock(() => now)
    const starts: number[] = []

    const requests = [0, 1, 2].map(() =>
      scheduleRequest({
        instanceId: 'instance-a',
        method: 'getChatHistory',
        signal: new AbortController().signal,
        run: () => {
          starts.push(now)
          return Promise.resolve(undefined)
        },
      }),
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toEqual([0])

    now = 5_000
    await vi.advanceTimersByTimeAsync(1200)
    expect(starts).toEqual([0, 5_000])

    now = 6_200
    await vi.advanceTimersByTimeAsync(1200)
    await Promise.all(requests)
    expect(starts).toEqual([0, 5_000, 6_200])
  })

  it('drops a task cancelled before start and keeps a task cancelled after start on the interval', async () => {
    vi.useFakeTimers()
    const starts: string[] = []
    const first = deferred<string>()
    const early = new AbortController()
    const running = new AbortController()
    let releaseRunning: (value: string) => void = () => {
      throw new Error('running release is not ready')
    }
    const runningResult = new Promise<string>((resolve) => {
      releaseRunning = resolve
    })

    const started = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: running.signal,
      run: (signal) => {
        starts.push('started')
        signal.addEventListener('abort', () => {
          releaseRunning('aborted')
        })
        return runningResult
      },
    })
    const removed = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: early.signal,
      run: () => {
        starts.push('removed')
        return Promise.resolve('removed')
      },
    })
    const third = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push('third')
        return first.promise
      },
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toEqual(['started'])
    early.abort()
    await expect(removed).rejects.toMatchObject({ kind: 'abort' })
    running.abort()
    await expect(started).resolves.toBe('aborted')

    await vi.advanceTimersByTimeAsync(1199)
    expect(starts).toEqual(['started'])
    await vi.advanceTimersByTimeAsync(1)
    expect(starts).toEqual(['started', 'third'])
    first.resolve('third')
    await expect(third).resolves.toBe('third')
  })

  it('continues the queue after a request error', async () => {
    vi.useFakeTimers()
    const failure = new GreenApiError('http', 'HTTP 429', { status: 429 })
    const starts: string[] = []

    const failed = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: async () => {
        starts.push('failed')
        await Promise.resolve()
        throw failure
      },
    })
    const next = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push('next')
        return Promise.resolve('ok')
      },
    })
    const failedResult = expect(failed).rejects.toBe(failure)
    const nextResult = expect(next).resolves.toBe('ok')

    await vi.advanceTimersByTimeAsync(0)
    await failedResult
    expect(starts).toEqual(['failed'])
    await vi.advanceTimersByTimeAsync(1199)
    expect(starts).toEqual(['failed'])
    await vi.advanceTimersByTimeAsync(1)
    await nextResult
    expect(starts).toEqual(['failed', 'next'])
  })

  it('keeps separate queues for instances and methods', async () => {
    vi.useFakeTimers()
    const starts: string[] = []

    const history = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push('history-a')
        return Promise.resolve('history-a')
      },
    })
    const chats = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChats',
      signal: new AbortController().signal,
      run: () => {
        starts.push('chats-a')
        return Promise.resolve('chats-a')
      },
    })
    const other = scheduleRequest({
      instanceId: 'instance-b',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push('history-b')
        return Promise.resolve('history-b')
      },
    })

    await vi.advanceTimersByTimeAsync(0)
    await Promise.all([history, chats, other])
    expect(starts).toEqual(['history-a', 'chats-a', 'history-b'])
  })

  it('releases abort handlers for finished and cancelled tasks', async () => {
    vi.useFakeTimers()
    const finished = new AbortController()
    const cancelled = new AbortController()
    const finishedRemove = vi.spyOn(finished.signal, 'removeEventListener')
    const cancelledRemove = vi.spyOn(cancelled.signal, 'removeEventListener')
    const gate = deferred<void>()

    const running = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: finished.signal,
      run: () => gate.promise.then(() => 'done'),
    })
    const waiting = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: cancelled.signal,
      run: () => Promise.resolve('skipped'),
    })

    await vi.advanceTimersByTimeAsync(0)
    cancelled.abort()
    await expect(waiting).rejects.toMatchObject({ kind: 'abort' })
    expect(cancelledRemove).toHaveBeenCalled()
    gate.resolve()
    await expect(running).resolves.toBe('done')
    expect(finishedRemove).toHaveBeenCalled()
  })

  it('does not rate-limit GetStateInstance behind GetChatHistory', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const historyController = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input)
      if (url.includes('getChatHistory')) {
        calls.push('history')
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        })
      }
      calls.push('state')
      return Promise.resolve(jsonResponse({ stateInstance: 'authorized' }))
    })
    const client = createGreenApiClient(connection, { fetchImpl })

    const history = client.getChatHistory(
      { chatId: '10000000', count: 1 },
      { signal: historyController.signal },
    )
    await client.getStateInstance()
    historyController.abort()
    await expect(history).rejects.toMatchObject({ kind: 'abort' })

    expect(calls).toEqual(['history', 'state'])
  })

  it('spaces every client method by its configured fetch interval', async () => {
    vi.useFakeTimers()
    const cases: Array<{
      method: string
      intervalMs: number
      call: (
        client: ReturnType<typeof createGreenApiClient>,
      ) => Promise<unknown>
    }> = [
      {
        method: 'getStateInstance',
        intervalMs: 1200,
        call: (client) => client.getStateInstance(),
      },
      {
        method: 'getChats',
        intervalMs: 1200,
        call: (client) => client.getChats(),
      },
      {
        method: 'getChatHistory',
        intervalMs: 1200,
        call: (client) =>
          client.getChatHistory({ chatId: '10000000', count: 1 }),
      },
      {
        method: 'readChat',
        intervalMs: 1200,
        call: (client) =>
          client.readChat({ chatId: '10000000', idMessage: 'provider-1' }),
      },
      {
        method: 'deleteMessage',
        intervalMs: 1200,
        call: (client) =>
          client.deleteMessage({
            chatId: '10000000',
            idMessage: 'provider-1',
          }),
      },
      {
        method: 'checkAccount',
        intervalMs: 120,
        call: (client) => client.checkAccount({ phoneNumber: 79991234567 }),
      },
      {
        method: 'getContactInfo',
        intervalMs: 120,
        call: (client) => client.getContactInfo({ chatId: '10000000' }),
      },
      {
        method: 'sendMessage',
        intervalMs: 24,
        call: (client) =>
          client.sendMessage({ chatId: '10000000', message: 'Привет' }),
      },
      {
        method: 'editMessage',
        intervalMs: 24,
        call: (client) =>
          client.editMessage({
            chatId: '10000000',
            idMessage: 'provider-1',
            message: 'Привет',
          }),
      },
      {
        method: 'forwardMessages',
        intervalMs: 24,
        call: (client) =>
          client.forwardMessages({
            chatId: '20000000',
            chatIdFrom: '10000000',
            messages: ['provider-1'],
          }),
      },
      {
        method: 'receiveNotification',
        intervalMs: 12,
        call: (client) => client.receiveNotification(),
      },
      {
        method: 'deleteNotification',
        intervalMs: 12,
        call: (client) => client.deleteNotification(10),
      },
    ]

    for (const item of cases) {
      resetRequestRate()
      const starts: number[] = []
      const methods: string[] = []
      const fetchImpl = vi.fn<typeof fetch>((input) => {
        starts.push(performance.now())
        methods.push(apiMethod(input))
        return Promise.resolve(jsonResponse({}))
      })
      const client = createGreenApiClient(connection, { fetchImpl })
      const first = item.call(client).catch(() => undefined)
      const second = item.call(client).catch(() => undefined)

      await vi.advanceTimersByTimeAsync(0)
      expect(methods, item.method).toEqual([item.method])
      await vi.advanceTimersByTimeAsync(item.intervalMs - 1)
      expect(starts, item.method).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      await Promise.all([first, second])

      expect(methods, item.method).toEqual([item.method, item.method])
      expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(
        item.intervalMs,
      )
    }
  })

  it('does not send a queued request after abort and keeps the used interval', async () => {
    vi.useFakeTimers()
    const starts: number[] = []
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      starts.push(performance.now())
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    })
    const client = createGreenApiClient(connection, { fetchImpl })
    const running = new AbortController()
    const queued = new AbortController()
    const following = new AbortController()
    const first = client.getChats({ signal: running.signal })
    const second = client.getChats({ signal: queued.signal })
    await vi.advanceTimersByTimeAsync(0)
    queued.abort()
    await expect(second).rejects.toMatchObject({ kind: 'abort' })
    expect(starts).toEqual([0])

    const third = client.getChats({ signal: following.signal })
    running.abort()
    await expect(first).rejects.toMatchObject({ kind: 'abort' })
    await vi.advanceTimersByTimeAsync(1199)
    expect(starts).toEqual([0])
    await vi.advanceTimersByTimeAsync(1)
    expect(starts).toEqual([0, 1200])
    following.abort()
    await expect(third).rejects.toMatchObject({ kind: 'abort' })
  })

  it('starts the HTTP timeout when the request is sent', async () => {
    vi.useFakeTimers()
    const starts: number[] = []
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      starts.push(performance.now())
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    })
    const client = createGreenApiClient(connection, {
      fetchImpl,
      timeouts: { ...requestTimeouts, requestTimeoutMs: 5_000 },
    })
    const first = client.getChats()
    const second = client.getChats()
    const firstResult = expect(first).rejects.toMatchObject({ kind: 'timeout' })
    const secondResult = expect(second).rejects.toMatchObject({
      kind: 'timeout',
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toEqual([0])
    await vi.advanceTimersByTimeAsync(4_999)
    expect(starts).toEqual([0])
    await vi.advanceTimersByTimeAsync(1)
    await firstResult
    expect(starts).toEqual([0, 5_000])
    await vi.advanceTimersByTimeAsync(4_999)
    expect(starts).toEqual([0, 5_000])
    await vi.advanceTimersByTimeAsync(1)
    await secondResult
  })

  it('keeps ReceiveNotification before DeleteNotification and spaces the next receive', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const method = apiMethod(input)
      order.push(method)
      if (method === 'receiveNotification' && order.length === 1) {
        return Promise.resolve(
          jsonResponse({
            receiptId: 10,
            body: {
              typeWebhook: 'incomingMessageReceived',
              timestamp: 1763115112,
              idMessage: '1763115112345',
              senderData: { chatId: '10000000' },
              messageData: {
                typeMessage: 'textMessage',
                textMessageData: { textMessage: 'Привет' },
              },
            },
          }),
        )
      }
      if (method === 'deleteNotification') {
        return Promise.resolve(jsonResponse({ result: true, reason: '' }))
      }
      return Promise.resolve(jsonResponse(null))
    })
    const client = createGreenApiClient(connection, { fetchImpl })

    const first = await client.receiveNotification()
    await client.deleteNotification(first?.receiptId ?? 0)
    const next = client.receiveNotification()

    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['receiveNotification', 'deleteNotification'])
    await vi.advanceTimersByTimeAsync(11)
    expect(order).toEqual(['receiveNotification', 'deleteNotification'])
    await vi.advanceTimersByTimeAsync(1)
    await next
    expect(order).toEqual([
      'receiveNotification',
      'deleteNotification',
      'receiveNotification',
    ])
  })

  it('waits the remaining interval for the same method after a reload', async () => {
    vi.useFakeTimers()
    installMemorySessionStorage()

    const first = await loadRequestRate()
    let firstAt = 0
    const firstRequest = first.scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        firstAt = Date.now()
        return Promise.resolve('first')
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    await firstRequest
    expect(storedStart('instance-a', 'getChatHistory')).toBe(firstAt)
    expect(firstAt).toBeGreaterThan(performance.now())

    await vi.advanceTimersByTimeAsync(400)
    const second = await loadRequestRate()
    const starts: number[] = []
    const secondRequest = second.scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push(Date.now())
        return Promise.resolve('second')
      },
    })

    await vi.advanceTimersByTimeAsync(799)
    expect(starts).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await secondRequest
    expect(starts).toEqual([firstAt + 1200])
  })

  it('restores each instance and method on its own after a reload', async () => {
    vi.useFakeTimers()
    installMemorySessionStorage()

    const first = await loadRequestRate()
    const started = first.scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => Promise.resolve('history-a'),
    })
    await vi.advanceTimersByTimeAsync(0)
    await started
    await vi.advanceTimersByTimeAsync(400)

    const second = await loadRequestRate()
    const starts: string[] = []
    const history = second.scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push('history-a')
        return Promise.resolve('history-a')
      },
    })
    const chats = second.scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChats',
      signal: new AbortController().signal,
      run: () => {
        starts.push('chats-a')
        return Promise.resolve('chats-a')
      },
    })
    const other = second.scheduleRequest({
      instanceId: 'instance-b',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push('history-b')
        return Promise.resolve('history-b')
      },
    })

    await vi.advanceTimersByTimeAsync(0)
    await Promise.all([chats, other])
    expect(starts).toEqual(['chats-a', 'history-b'])
    await vi.advanceTimersByTimeAsync(799)
    expect(starts).toEqual(['chats-a', 'history-b'])
    await vi.advanceTimersByTimeAsync(1)
    await history
    expect(starts).toEqual(['chats-a', 'history-b', 'history-a'])
  })

  it('keeps the stored start when a request is cancelled after it was sent', async () => {
    vi.useFakeTimers()
    installMemorySessionStorage()
    const running = new AbortController()
    let releaseRunning: (value: string) => void = () => {
      throw new Error('running release is not ready')
    }
    const runningResult = new Promise<string>((resolve) => {
      releaseRunning = resolve
    })

    const started = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: running.signal,
      run: (signal) => {
        signal.addEventListener('abort', () => {
          releaseRunning('aborted')
        })
        return runningResult
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    const mark = sessionStorage.getItem(requestRateStorageKey)
    running.abort()
    await expect(started).resolves.toBe('aborted')
    expect(sessionStorage.getItem(requestRateStorageKey)).toBe(mark)

    await vi.advanceTimersByTimeAsync(100)
    const second = await loadRequestRate()
    const starts: number[] = []
    const next = second.scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push(Date.now())
        return Promise.resolve('next')
      },
    })
    await vi.advanceTimersByTimeAsync(1099)
    expect(starts).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await next
    expect(starts).toHaveLength(1)
  })

  it('stores only the instance, method, and wall-clock start', async () => {
    vi.useFakeTimers()
    installMemorySessionStorage()
    sessionStorage.setItem(
      'green-api.connection',
      JSON.stringify({ apiTokenInstance: connection.apiTokenInstance }),
    )
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse([historyRow])),
    )
    const client = createGreenApiClient(connection, { fetchImpl })

    await client.getChatHistory({ chatId: '10000000', count: 1 })

    const raw = sessionStorage.getItem(requestRateStorageKey) ?? ''
    const stored = JSON.parse(raw) as Record<string, unknown>
    const startedAt =
      stored[
        'https://3100.api.green-api.com\u00003100000001\u0000getChatHistory'
      ]
    expect(Object.keys(stored)).toEqual([
      'https://3100.api.green-api.com\u00003100000001\u0000getChatHistory',
    ])
    expect(typeof startedAt).toBe('number')
    expect(raw).not.toContain(connection.apiTokenInstance)
    expect(raw).not.toContain('waInstance')
    expect(raw).not.toContain('Привет')
    expect(sessionStorage.getItem('green-api.connection')).toBe(
      JSON.stringify({ apiTokenInstance: connection.apiTokenInstance }),
    )
  })

  it('starts immediately when stored rate data is damaged', async () => {
    vi.useFakeTimers()
    installMemorySessionStorage()
    sessionStorage.setItem(requestRateStorageKey, '{')
    const starts: number[] = []

    const request = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push(1)
        return Promise.resolve('ok')
      },
    })

    await vi.advanceTimersByTimeAsync(0)
    await request
    expect(starts).toEqual([1])
  })

  it('caps a backwards clock at one interval and ignores a forwards jump', async () => {
    vi.useFakeTimers()
    installMemorySessionStorage()
    sessionStorage.setItem(
      requestRateStorageKey,
      JSON.stringify({
        'instance-a\u0000getChatHistory': Date.now() + 60_000,
        'instance-b\u0000getChatHistory': Date.now() - 10_000,
      }),
    )
    const starts: string[] = []
    const waited = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push('waited')
        return Promise.resolve('waited')
      },
    })
    const jumped = scheduleRequest({
      instanceId: 'instance-b',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push('jumped')
        return Promise.resolve('jumped')
      },
    })

    await vi.advanceTimersByTimeAsync(0)
    await jumped
    expect(starts).toEqual(['jumped'])
    await vi.advanceTimersByTimeAsync(1199)
    expect(starts).toEqual(['jumped'])
    await vi.advanceTimersByTimeAsync(1)
    await waited
    expect(starts).toEqual(['jumped', 'waited'])
  })

  it('keeps scheduling when sessionStorage is unavailable', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('sessionStorage is unavailable')
      },
      setItem: () => {
        throw new Error('sessionStorage is unavailable')
      },
      removeItem: () => {
        throw new Error('sessionStorage is unavailable')
      },
    })
    const starts: number[] = []
    const first = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push(performance.now())
        return Promise.resolve('first')
      },
    })
    const second = scheduleRequest({
      instanceId: 'instance-a',
      method: 'getChatHistory',
      signal: new AbortController().signal,
      run: () => {
        starts.push(performance.now())
        return Promise.resolve('second')
      },
    })

    await vi.advanceTimersByTimeAsync(0)
    await first
    expect(starts).toEqual([0])
    await vi.advanceTimersByTimeAsync(1199)
    expect(starts).toEqual([0])
    await vi.advanceTimersByTimeAsync(1)
    await second
    expect(starts).toEqual([0, 1200])
  })
})

function historyFetch(
  starts: number[],
  counts: number[],
): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>((_input, init) => {
    starts.push(performance.now())
    const body = JSON.parse(requestBody(init)) as { count?: number }
    counts.push(body.count ?? 0)
    return Promise.resolve(jsonResponse([historyRow]))
  })
}

function apiMethod(input: Parameters<typeof fetch>[0]): string {
  const matched = /\/waInstance\d+\/([^/?]+)/.exec(requestUrl(input))
  return matched?.[1] ?? ''
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.href
  }
  return input.url
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body === 'string') {
    return init.body
  }
  throw new Error('expected a string request body')
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function loadRequestRate() {
  vi.resetModules()
  return import('@/shared/api/request-rate.ts')
}

function installMemorySessionStorage(): void {
  const values = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  })
}

function storedStart(instanceId: string, method: string): number | null {
  const raw = sessionStorage.getItem(requestRateStorageKey)
  if (raw === null) {
    return null
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>
  const value = parsed[`${instanceId}\u0000${method}`]
  return typeof value === 'number' ? value : null
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => {
    throw new Error('deferred resolve is not ready')
  }
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve: (value: T) => {
      resolvePromise(value)
    },
  }
}
