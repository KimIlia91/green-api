import type { SessionConnection } from './types.ts'

export function sessionIdentity(connection: SessionConnection | null): string {
  if (connection === null) {
    return ''
  }

  return `${connection.apiUrl}\u0000${connection.idInstance}`
}
