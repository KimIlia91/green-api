import { describe, expect, it } from 'vitest'

import { chatInitials, chatTitle } from '@/entities/chat/model/chat-title.ts'
import type { Chat } from '@/entities/chat/model/chat.types.ts'

const base = {
  chatId: '10000000',
  phoneNumber: '79991234567',
  name: null,
  username: null,
  preview: null,
  previewForwarded: false,
  lastActivityAt: null,
  unseenIncomingIds: [],
} satisfies Chat

describe('chatTitle', () => {
  it('prefers a contact name, then username, then phone', () => {
    expect(chatTitle({ ...base, name: 'Анна', username: 'anna' })).toBe('Анна')
    expect(chatTitle({ ...base, name: '   ', username: ' anna ' })).toBe('anna')
    expect(chatTitle({ ...base, username: '   ' })).toBe('+79991234567')
    expect(
      chatTitle({
        ...base,
        phoneNumber: null,
        name: null,
        username: null,
      }),
    ).toBe('Контакт без имени')
  })

  it('does not use chatId as a title', () => {
    const title = chatTitle({
      chatId: '10000000',
      phoneNumber: null,
      name: ' ',
      username: '',
      preview: null,
      previewForwarded: false,
      lastActivityAt: null,
      unseenIncomingIds: [],
    })

    expect(title).not.toBe('10000000')
  })
})

describe('chatInitials', () => {
  it('uses the visible title', () => {
    expect(chatInitials({ ...base, name: 'Анна' })).toBe('АН')
    expect(chatInitials(base)).toBe('67')
  })
})
