import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearSession,
  establishSession,
  selectIsAuthorized,
  useSessionStore,
} from '@/entities/session'

import { disconnectFromInstance } from '@/features/disconnect-instance/model/disconnect.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('disconnectFromInstance', () => {
  beforeEach(() => {
    clearSession()
  })

  it('clears credentials and does not call GREEN-API', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 500 }))
    establishSession(connection, 'authorized')

    disconnectFromInstance()

    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
    expect(useSessionStore.getState().connection).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
