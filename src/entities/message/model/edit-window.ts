import { unsupportedMessageText } from './message-copy.ts'
import type { MessageDirection } from './message.types.ts'

export const editWindowMs = 24 * 60 * 60 * 1000

export const editExpiredMessage =
  'Время редактирования истекло — сообщение можно изменить только в течение 24 часов после отправки'

export type EditCandidate = {
  direction: MessageDirection
  text: string
  stickerUrl: string | null
  providerId: string | null
  sentAt: number | null
}

export function canEditMessage(message: EditCandidate, now: number): boolean {
  if (message.direction !== 'outgoing' || message.stickerUrl !== null) {
    return false
  }

  if (
    message.text === '' ||
    message.text === unsupportedMessageText ||
    (message.providerId?.trim() ?? '') === ''
  ) {
    return false
  }

  const sentAt = originalSentAt(message.sentAt)
  if (sentAt === null || !Number.isFinite(now)) {
    return false
  }

  if (sentAt > now) {
    return false
  }

  return now - sentAt < editWindowMs
}

export function originalSentAt(
  sentAt: number | null | undefined,
): number | null {
  if (
    typeof sentAt !== 'number' ||
    !Number.isSafeInteger(sentAt) ||
    sentAt < 0
  ) {
    return null
  }

  return sentAt
}

export function editDeadline(sentAt: number | null | undefined): number | null {
  const value = originalSentAt(sentAt)
  if (value === null) {
    return null
  }

  const deadline = value + editWindowMs
  if (!Number.isSafeInteger(deadline)) {
    return null
  }

  return deadline
}
