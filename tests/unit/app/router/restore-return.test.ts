import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearSession,
  establishSession,
  selectIsAuthorized,
  useSessionStore,
} from '@/entities/session'
import { restoreStoredConnection } from '@/features/connect-instance'
import * as loadChats from '@/features/load-chats'
import {
  startReceiveLoop,
  stopReceiveLoop,
} from '@/features/receive-notifications'
import type { ReceivedNotification } from '@/shared/api'

import {
  claimChatsReturn,
  rememberChatsReturn,
  resetRouteMemory,
} from '@/app/router/return-path.ts'
import { loginRedirect } from '@/app/router/session-gate.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('session restore routing', () => {
  beforeEach(() => {
    installMemorySessionStorage()
    stopReceiveLoop()
    resetRouteMemory()
    clearSession()
  })

  afterEach(() => {
    stopReceiveLoop()
    resetRouteMemory()
    clearSession()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns to /chats/:chatId only after a live authorized check', async () => {
    establishSession(connection, 'authorized')
    useSessionStore.setState({ connection: null, stateInstance: null })
    const decision = loginRedirect({
      pathname: '/chats/10000000',
      leaving: false,
    })
    if (decision.remember !== null) {
      rememberChatsReturn(decision.remember)
    }

    const getStateInstance = vi.fn(() =>
      Promise.resolve({ stateInstance: 'authorized' as const }),
    )
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)

    await restoreStoredConnection({ getStateInstance })

    expect(getStateInstance).toHaveBeenCalledTimes(1)
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(true)
    expect(claimChatsReturn()).toBe('/chats/10000000')
  })

  it('does not start chats or a second notification loop during restore', async () => {
    const loadChatList = vi
      .spyOn(loadChats, 'loadChatList')
      .mockResolvedValue(undefined)
    establishSession(connection, 'authorized')
    useSessionStore.setState({ connection: null, stateInstance: null })
    let receiveCalls = 0
    const pending = deferred<ReceivedNotification | null>()

    await restoreStoredConnection({
      getStateInstance: () => Promise.resolve({ stateInstance: 'authorized' }),
    })

    expect(loadChatList).not.toHaveBeenCalled()

    startReceiveLoop({
      client: {
        receiveNotification: () => {
          receiveCalls += 1
          return pending.promise
        },
        deleteNotification: () => Promise.resolve({ result: true, reason: '' }),
      },
    })
    startReceiveLoop({
      client: {
        receiveNotification: () => {
          receiveCalls += 1
          return Promise.resolve(null)
        },
        deleteNotification: () => Promise.resolve({ result: true, reason: '' }),
      },
    })

    await Promise.resolve()
    expect(receiveCalls).toBe(1)
    stopReceiveLoop()
    pending.resolve(null)
  })
})

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
