import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearSession,
  selectIsAuthorized,
  useSessionStore,
} from '@/entities/session'
import { GreenApiError, type InstanceState } from '@/shared/api'

import {
  connectToInstance,
  knownRejectedStates,
  messageForInstanceState,
  readinessMessage,
  stateInstanceRateLimitMessage,
  type ConnectDraft,
} from '@/features/connect-instance/model/connect-to-instance.ts'
import { createSubmitGate } from '@/features/connect-instance/model/submit-gate.ts'

const draft: ConnectDraft = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('connectToInstance', () => {
  beforeEach(() => {
    clearSession()
  })

  it('establishes a session for authorized', async () => {
    const outcome = await connectToInstance({
      draft,
      signal: new AbortController().signal,
      isStale: () => false,
      client: clientReturning('authorized'),
    })

    expect(outcome).toEqual({ status: 'authorized' })
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(true)
    expect(useSessionStore.getState().connection).toEqual(draft)
  })

  it.each(knownRejectedStates)(
    'does not open messenger for %s',
    async (stateInstance) => {
      const outcome = await connectToInstance({
        draft,
        signal: new AbortController().signal,
        isStale: () => false,
        client: clientReturning(stateInstance),
      })

      expect(outcome).toEqual({
        status: 'rejected',
        message: messageForInstanceState(stateInstance),
      })
      expect(outcome.status === 'rejected' && outcome.message).toContain(
        'не ошибка токена',
      )
      expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
    },
  )

  it('reports an unknown state without opening messenger', async () => {
    const outcome = await connectToInstance({
      draft,
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        getStateInstance: () =>
          Promise.reject(
            new GreenApiError(
              'invalid-response',
              'GetStateInstance stateInstance',
            ),
          ),
      },
    })

    expect(outcome).toEqual({
      status: 'rejected',
      message: readinessMessage,
    })
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
  })

  it.each([
    ['http', new GreenApiError('http', 'HTTP 401', { status: 401 })],
    ['network', new GreenApiError('network', 'Network request failed')],
    ['timeout', new GreenApiError('timeout', 'Request timed out')],
  ] as const)(
    'keeps messenger closed after a %s error',
    async (_kind, error) => {
      const outcome = await connectToInstance({
        draft,
        signal: new AbortController().signal,
        isStale: () => false,
        client: {
          getStateInstance: () => Promise.reject(error),
        },
      })

      expect(outcome.status).toBe('rejected')
      if (outcome.status === 'rejected') {
        expect(outcome.message).not.toMatch(/abc123|green-api\.com/i)
      }
      expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
    },
  )

  it('asks to wait after HTTP 429 and keeps the credentials hint for other HTTP errors', async () => {
    const rateLimited = await connectToInstance({
      draft,
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        getStateInstance: () =>
          Promise.reject(
            new GreenApiError('http', 'HTTP 429', { status: 429 }),
          ),
      },
    })
    const unauthorized = await connectToInstance({
      draft,
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        getStateInstance: () =>
          Promise.reject(
            new GreenApiError('http', 'HTTP 401', { status: 401 }),
          ),
      },
    })

    expect(rateLimited).toEqual({
      status: 'rejected',
      message: stateInstanceRateLimitMessage,
    })
    expect(unauthorized).toEqual({
      status: 'rejected',
      message:
        'GREEN-API не принял запрос HTTP 401. Проверьте реквизиты в личном кабинете и повторите попытку.',
    })
  })

  it('does not request the API when required fields are empty', async () => {
    const getStateInstance = vi.fn()
    const outcome = await connectToInstance({
      draft: { apiUrl: ' ', idInstance: '', apiTokenInstance: '' },
      signal: new AbortController().signal,
      isStale: () => false,
      client: { getStateInstance },
    })

    expect(outcome.status).toBe('invalid')
    expect(getStateInstance).not.toHaveBeenCalled()
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
  })

  it('does not establish a session from a late response', async () => {
    const pending = deferred<InstanceState>()
    const controller = new AbortController()
    let stale = false
    const request = connectToInstance({
      draft,
      signal: controller.signal,
      isStale: () => stale,
      client: {
        getStateInstance: () =>
          pending.promise.then((stateInstance) => ({ stateInstance })),
      },
    })

    stale = true
    controller.abort()
    pending.resolve('authorized')

    await expect(request).resolves.toEqual({ status: 'ignored' })
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
  })

  it('blocks a second submit while the request is in flight', async () => {
    const gate = createSubmitGate()
    const pending = deferred<InstanceState>()
    expect(gate.tryEnter()).toBe(true)

    const request = connectToInstance({
      draft,
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        getStateInstance: () =>
          pending.promise.then((stateInstance) => ({ stateInstance })),
      },
    })

    expect(gate.tryEnter()).toBe(false)
    pending.resolve('authorized')
    await request
    gate.leave()

    expect(gate.tryEnter()).toBe(true)
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(true)
  })
})

function clientReturning(stateInstance: InstanceState) {
  return {
    getStateInstance: () => Promise.resolve({ stateInstance }),
  }
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
