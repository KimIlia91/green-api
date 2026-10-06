import type { GetContactInfoResult } from '@/shared/api'

export type ContactProfile = {
  name: string | null
  username: null
  phoneNumber: string | null
}

export function contactProfile(info: GetContactInfoResult): ContactProfile {
  return {
    name: firstVisible(info.contactName, info.name),
    username: null,
    phoneNumber:
      info.phoneNumber > 0 && Number.isSafeInteger(info.phoneNumber)
        ? String(info.phoneNumber)
        : null,
  }
}

function firstVisible(...values: string[]): string | null {
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed !== '') {
      return trimmed
    }
  }

  return null
}
