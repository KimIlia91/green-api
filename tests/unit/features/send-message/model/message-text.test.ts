import { describe, expect, it } from 'vitest'

import {
  messageTextIssue,
  messageTextMessage,
} from '@/features/send-message/model/message-text.ts'

describe('messageTextIssue', () => {
  it('rejects empty text and text over 4000 characters', () => {
    expect(messageTextIssue('')).toBe('empty')
    expect(messageTextIssue(' \n\t ')).toBe('empty')
    expect(messageTextIssue('a'.repeat(4000))).toBeNull()
    expect(messageTextIssue('a'.repeat(4001))).toBe('too-long')
  })

  it('keeps a readable explanation', () => {
    expect(messageTextMessage('empty')).toBe('Введите текст сообщения.')
    expect(messageTextMessage('too-long')).toBe(
      'Сообщение длиннее 4000 символов.',
    )
  })
})
