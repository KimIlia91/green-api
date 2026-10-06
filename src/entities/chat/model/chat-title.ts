import type { Chat } from './chat.types.ts'

const fallbackTitle = 'Контакт без имени'

export function chatTitle(chat: Chat): string {
  const name = visible(chat.name)
  if (name !== null) {
    return name
  }

  const username = visible(chat.username)
  if (username !== null) {
    return username
  }

  const phone = visible(chat.phoneNumber)
  if (phone !== null) {
    return phone.startsWith('+') ? phone : `+${phone}`
  }

  return fallbackTitle
}

export function reliableContactName(chat: Chat): string | null {
  const name = visible(chat.name)
  if (name !== null) {
    return name
  }

  return visible(chat.username)
}

export function chatInitials(chat: Chat): string {
  const title = chatTitle(chat)
  if (/^\+?\d+$/.test(title)) {
    return title.replace(/\D/g, '').slice(-2)
  }

  const letters = title.replace(/[^\p{L}\p{N}]/gu, '')
  if (letters.length >= 2) {
    return letters.slice(0, 2).toUpperCase()
  }

  return title.slice(0, 2)
}

function visible(value: string | null): string | null {
  if (value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
