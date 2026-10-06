import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetMessages, useMessageStore } from '@/entities/message'
import {
  clearSession,
  establishSession,
  readStoredCredentials,
  selectIsAuthorized,
  sessionCredentialStorageKey,
  useSessionStore,
} from '@/entities/session'
import { GreenApiError, type GetStateInstanceResult } from '@/shared/api'

import {
  messageForInstanceState,
  stateInstanceRateLimitMessage,
} from '@/features/connect-instance/model/connect-to-instance.ts'
import {
  cancelConnectionRestore,
  restoreStoredConnection,
  watchConnectionRestore,
} from '@/features/connect-instance/model/restore-connection.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('restoreStoredConnection', () => {
  beforeEach(() => {
    installMemorySessionStorage()
    cancelConnectionRestore()
    resetMessages()
    clearSession()
  })

  afterEach(() => {
    cancelConnectionRestore()
    vi.unstubAllGlobals()
  })

  it('does nothing when storage is empty', async () => {
    const getStateInstance = vi.fn()

    await expect(
      restoreStoredConnection({ getStateInstance }),
    ).resolves.toEqual({ status: 'absent' })
    expect(getStateInstance).not.toHaveBeenCalled()
  })

  it('opens a session only after GetStateInstance returns authorized', async () => {
    saveCredentials({
      stateInstance: 'authorized',
      messages: [{ text: 'secret' }],
      draft: 'черновик',
    })
    dropSessionMemory()
    const getStateInstance = vi.fn(() =>
      Promise.resolve({ stateInstance: 'authorized' as const }),
    )

    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)

    await expect(
      restoreStoredConnection({ getStateInstance }),
    ).resolves.toEqual({ status: 'authorized' })
    expect(getStateInstance).toHaveBeenCalledTimes(1)
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(true)
    expect(useMessageStore.getState().messagesById).toEqual({})
    expect(Object.keys(storedRecord() ?? {})).toEqual([
      'apiUrl',
      'idInstance',
      'apiTokenInstance',
    ])
  })

  it('does not open messenger when the instance is not ready', async () => {
    saveCredentials({ stateInstance: 'authorized' })
    dropSessionMemory()

    const outcome = await restoreStoredConnection({
      getStateInstance: () => Promise.resolve({ stateInstance: 'starting' }),
    })

    expect(outcome).toEqual({
      status: 'rejected',
      message: messageForInstanceState('starting'),
    })
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
    expect(readStoredCredentials()).toEqual(connection)
  })

  it.each(['timeout', 'network'] as const)(
    'keeps credentials after a %s error',
    async (kind) => {
      saveCredentials()
      dropSessionMemory()

      const outcome = await restoreStoredConnection({
        getStateInstance: () =>
          Promise.reject(new GreenApiError(kind, 'unavailable')),
      })

      expect(outcome.status).toBe('rejected')
      if (outcome.status === 'rejected') {
        expect(outcome.message).not.toContain('ошибка токена')
      }
      expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
      expect(readStoredCredentials()).toEqual(connection)
    },
  )

  it('ignores a late authorized response after reset', async () => {
    saveCredentials()
    dropSessionMemory()
    const pending = deferred<GetStateInstanceResult>()
    const outcome = restoreStoredConnection({
      getStateInstance: () => pending.promise,
    })

    cancelConnectionRestore()
    clearSession()
    pending.resolve({ stateInstance: 'authorized' })

    await expect(outcome).resolves.toEqual({ status: 'ignored' })
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
    expect(readStoredCredentials()).toBeNull()
  })

  it('joins a second restore to the in-flight GetStateInstance', async () => {
    saveCredentials()
    dropSessionMemory()
    const pending = deferred<GetStateInstanceResult>()
    let signal: AbortSignal | undefined
    const getStateInstance = vi.fn((options?: { signal?: AbortSignal }) => {
      signal = options?.signal
      return pending.promise
    })
    const client = { getStateInstance }
    const outcomes: string[] = []

    const stop = watchConnectionRestore((outcome) => {
      outcomes.push(outcome.status)
    }, client)
    const joined = restoreStoredConnection(client)
    stop()

    expect(getStateInstance).toHaveBeenCalledTimes(1)
    expect(signal?.aborted).toBe(false)

    pending.resolve({ stateInstance: 'authorized' })

    await expect(joined).resolves.toEqual({ status: 'authorized' })
    expect(getStateInstance).toHaveBeenCalledTimes(1)
    expect(outcomes).toEqual([])
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(true)
  })

  it('starts one new GetStateInstance after the previous restore settles', async () => {
    saveCredentials()
    dropSessionMemory()
    let calls = 0
    const getStateInstance = vi.fn(() => {
      calls += 1
      if (calls === 1) {
        return Promise.reject(
          new GreenApiError('http', 'HTTP 429', { status: 429 }),
        )
      }

      return Promise.resolve({ stateInstance: 'starting' as const })
    })

    await expect(
      restoreStoredConnection({ getStateInstance }),
    ).resolves.toEqual({
      status: 'rejected',
      message: stateInstanceRateLimitMessage,
    })
    await expect(
      restoreStoredConnection({ getStateInstance }),
    ).resolves.toEqual({
      status: 'rejected',
      message: messageForInstanceState('starting'),
    })
    expect(getStateInstance).toHaveBeenCalledTimes(2)
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
  })

  it('does not reuse a cancelled restore for the next attempt', async () => {
    saveCredentials()
    dropSessionMemory()
    const firstPending = deferred<GetStateInstanceResult>()
    const secondPending = deferred<GetStateInstanceResult>()
    const signals: AbortSignal[] = []
    const getStateInstance = vi.fn((options?: { signal?: AbortSignal }) => {
      if (options?.signal) {
        signals.push(options.signal)
      }

      return signals.length === 1 ? firstPending.promise : secondPending.promise
    })
    const client = { getStateInstance }

    const first = restoreStoredConnection(client)
    cancelConnectionRestore()
    const second = restoreStoredConnection(client)

    expect(getStateInstance).toHaveBeenCalledTimes(2)
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)

    firstPending.resolve({ stateInstance: 'authorized' })
    await expect(first).resolves.toEqual({ status: 'ignored' })
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)

    secondPending.resolve({ stateInstance: 'authorized' })
    await expect(second).resolves.toEqual({ status: 'authorized' })
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(true)
  })

  it('continues from memory when storage is unavailable', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })

    await expect(restoreStoredConnection()).resolves.toEqual({
      status: 'absent',
    })
    establishSession(connection, 'authorized')
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(true)
  })
})

function storedRecord(): Record<string, unknown> | null {
  const raw = sessionStorage.getItem(sessionCredentialStorageKey)
  if (raw === null) {
    return null
  }

  return JSON.parse(raw) as Record<string, unknown>
}

function saveCredentials(extra: Record<string, unknown> = {}): void {
  sessionStorage.setItem(
    sessionCredentialStorageKey,
    JSON.stringify({ ...connection, ...extra }),
  )
}

function dropSessionMemory(): void {
  useSessionStore.setState({
    connection: null,
    stateInstance: null,
  })
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
