import { describe, expect, it } from 'vitest'

import {
  canEditMessage,
  editWindowMs,
  type EditCandidate,
} from '@/entities/message/model/edit-window.ts'

const sentAt = 1_700_000_000_000

function candidate(patch: Partial<EditCandidate> = {}): EditCandidate {
  return {
    direction: 'outgoing',
    text: 'Привет',
    stickerUrl: null,
    providerId: 'provider-1',
    sentAt,
    ...patch,
  }
}

describe('canEditMessage', () => {
  it('allows an edit one millisecond before the window closes', () => {
    expect(canEditMessage(candidate(), sentAt + editWindowMs - 1)).toBe(true)
  })

  it('refuses an edit at exactly 24 hours', () => {
    expect(canEditMessage(candidate(), sentAt + editWindowMs)).toBe(false)
  })

  it('refuses an edit after 24 hours', () => {
    expect(canEditMessage(candidate(), sentAt + editWindowMs + 1)).toBe(false)
  })

  it('does not extend the window when the text changes', () => {
    const edited = candidate({ text: 'Новый текст' })
    expect(edited.sentAt).toBe(sentAt)
    expect(canEditMessage(edited, sentAt + editWindowMs)).toBe(false)
  })

  it('is available when the menu opens and unavailable when the item is chosen later', () => {
    const openedAt = sentAt + editWindowMs - 1
    const chosenAt = sentAt + editWindowMs
    expect(canEditMessage(candidate(), openedAt)).toBe(true)
    expect(canEditMessage(candidate(), chosenAt)).toBe(false)
  })

  it('refuses unknown, invalid, and future send times', () => {
    const now = sentAt + 1_000
    expect(canEditMessage(candidate({ sentAt: null }), now)).toBe(false)
    expect(canEditMessage(candidate({ sentAt: Number.NaN }), now)).toBe(false)
    expect(canEditMessage(candidate({ sentAt: 1.5 }), now)).toBe(false)
    expect(canEditMessage(candidate({ sentAt: -1 }), now)).toBe(false)
    expect(canEditMessage(candidate({ sentAt: now + 1 }), now)).toBe(false)
  })
})
