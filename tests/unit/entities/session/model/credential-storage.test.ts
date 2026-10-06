import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { selectIsAuthorized } from '@/entities/session/model/selectors.ts'
import {
  clearSession,
  establishSession,
  useSessionStore,
} from '@/entities/session/model/store.ts'
import {
  readStoredCredentials,
  sessionCredentialStorageKey,
} from '@/entities/session/model/credential-storage.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('credential storage', () => {
  beforeEach(() => {
    installMemorySessionStorage()
    clearSession()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads only the three credential fields', () => {
    establishSession(connection, 'authorized')

    expect(readStoredCredentials()).toEqual(connection)
    expect(Object.keys(storedRecord() ?? {})).toEqual([
      'apiUrl',
      'idInstance',
      'apiTokenInstance',
    ])
  })

  it('ignores a saved authorized flag', () => {
    sessionStorage.setItem(
      sessionCredentialStorageKey,
      JSON.stringify({ ...connection, stateInstance: 'authorized' }),
    )

    expect(readStoredCredentials()).toEqual(connection)
    expect(useSessionStore.getState().stateInstance).toBeNull()
    expect(useSessionStore.getState().connection).toBeNull()
  })

  it('drops a damaged payload and keeps working', () => {
    sessionStorage.setItem(sessionCredentialStorageKey, '{')

    expect(readStoredCredentials()).toBeNull()
    expect(sessionStorage.getItem(sessionCredentialStorageKey)).toBeNull()

    establishSession(connection, 'authorized')
    expect(useSessionStore.getState().connection).toEqual(connection)
  })

  it.each(['null', '[]', '1', '{"apiUrl":"https://3100.api.green-api.com"}'])(
    'drops a payload with the wrong shape: %s',
    (raw) => {
      sessionStorage.setItem(sessionCredentialStorageKey, raw)

      expect(readStoredCredentials()).toBeNull()
      expect(sessionStorage.getItem(sessionCredentialStorageKey)).toBeNull()
    },
  )

  it('keeps the in-memory session when sessionStorage throws', () => {
    vi.stubGlobal('sessionStorage', brokenSessionStorage())

    expect(readStoredCredentials()).toBeNull()
    establishSession(connection, 'authorized')
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(true)

    clearSession()
    expect(useSessionStore.getState().connection).toBeNull()
  })
})

function storedRecord(): Record<string, unknown> | null {
  const raw = sessionStorage.getItem(sessionCredentialStorageKey)
  if (raw === null) {
    return null
  }

  return JSON.parse(raw) as Record<string, unknown>
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
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })
}

function brokenSessionStorage(): Storage {
  const fail = () => {
    throw new Error('sessionStorage is unavailable')
  }

  return {
    getItem: fail,
    setItem: fail,
    removeItem: fail,
    clear: fail,
    key: fail,
    get length() {
      fail()
      return 0
    },
  }
}
