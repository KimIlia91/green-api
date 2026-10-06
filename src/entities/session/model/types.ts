import type { InstanceState } from '@/shared/api'

export type SessionConnection = {
  apiUrl: string
  idInstance: string
  apiTokenInstance: string
}

export type SessionState = {
  connection: SessionConnection | null
  stateInstance: InstanceState | null
}
