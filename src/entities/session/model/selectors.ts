import type { SessionState } from './types.ts'

export const selectIsAuthorized = (state: SessionState): boolean =>
  state.connection !== null && state.stateInstance === 'authorized'

export const selectIdInstance = (state: SessionState): string | null =>
  state.connection?.idInstance ?? null

export const selectStateInstance = (state: SessionState) => state.stateInstance

export const selectSessionConnection = (state: SessionState) => state.connection
