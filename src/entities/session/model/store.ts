import { create } from 'zustand'

import type { InstanceState } from '@/shared/api'

import {
  clearStoredCredentials,
  writeStoredCredentials,
} from './credential-storage.ts'
import type { SessionConnection, SessionState } from './types.ts'

type SessionStore = SessionState & {
  establishSession: (
    connection: SessionConnection,
    stateInstance: InstanceState,
  ) => void
  clearSession: () => void
}

const emptySession = {
  connection: null,
  stateInstance: null,
} satisfies SessionState

export const useSessionStore = create<SessionStore>()((set) => ({
  ...emptySession,
  establishSession: (connection, stateInstance) => {
    if (stateInstance !== 'authorized' || !hasCredentials(connection)) {
      return
    }

    set({
      connection,
      stateInstance,
    })
    writeStoredCredentials(connection)
  },
  clearSession: () => {
    set(emptySession)
    clearStoredCredentials()
  },
}))

export function establishSession(
  connection: SessionConnection,
  stateInstance: InstanceState,
): void {
  useSessionStore.getState().establishSession(connection, stateInstance)
}

export function clearSession(): void {
  useSessionStore.getState().clearSession()
}

function hasCredentials(connection: SessionConnection): boolean {
  return (
    connection.apiUrl.trim() !== '' &&
    connection.idInstance.trim() !== '' &&
    connection.apiTokenInstance.trim() !== ''
  )
}
