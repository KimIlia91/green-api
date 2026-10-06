import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sessionCredentialStorageKey } from '@/entities/session/model/credential-storage.ts'
import {
  clearSession,
  establishSession,
  useSessionStore,
} from '@/entities/session/model/store.ts'
import { selectIsAuthorized } from '@/entities/session/model/selectors.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('session store', () => {
  beforeEach(() => {
    clearSession()
  })

  it('stores credentials only for authorized', () => {
    establishSession(connection, 'authorized')

    expect(useSessionStore.getState().connection).toEqual(connection)
    expect(useSessionStore.getState().stateInstance).toBe('authorized')
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(true)
  })

  it('does not store other instance states', () => {
    for (const stateInstance of [
      'notAuthorized',
      'blocked',
      'starting',
      'suspended',
      'pendingPassword',
    ] as const) {
      establishSession(connection, stateInstance)
    }

    expect(useSessionStore.getState().connection).toBeNull()
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
  })

  it('clears credentials', () => {
    establishSession(connection, 'authorized')
    clearSession()

    expect(useSessionStore.getState()).toMatchObject({
      connection: null,
      stateInstance: null,
    })
  })

  it('writes the three credentials to sessionStorage only after authorized', () => {
    const values = new Map<string, string>()
    const localSet = vi.fn()
    vi.stubGlobal('localStorage', { setItem: localSet })
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    })

    try {
      establishSession(connection, 'starting')
      expect(values.size).toBe(0)

      establishSession(connection, 'authorized')
      expect(localSet).not.toHaveBeenCalled()
      expect(JSON.parse(values.get(sessionCredentialStorageKey) ?? '')).toEqual(
        connection,
      )
      expect('persist' in useSessionStore).toBe(false)

      clearSession()
      expect(values.size).toBe(0)
      expect(localSet).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
