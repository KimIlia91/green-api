import { clearSession } from '@/entities/session'

export function disconnectFromInstance(): void {
  clearSession()
}
