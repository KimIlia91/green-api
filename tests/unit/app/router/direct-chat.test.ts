import { describe, expect, it } from 'vitest'

import { directChatView } from '@/app/router/direct-chat.ts'
import { chatPath, isChatLocation } from '@/app/router/paths.ts'

describe('direct chat route', () => {
  it('waits while the list is still loading', () => {
    expect(
      directChatView({
        routeChatId: '10000000',
        listStatus: 'loading',
        chatExists: false,
      }),
    ).toBe('loading')
    expect(
      directChatView({
        routeChatId: '10000000',
        listStatus: 'idle',
        chatExists: false,
      }),
    ).toBe('loading')
  })

  it('shows the list error until the chat can be resolved', () => {
    expect(
      directChatView({
        routeChatId: '10000000',
        listStatus: 'error',
        chatExists: false,
      }),
    ).toBe('error')
  })

  it('opens a chat that already exists during list load or error', () => {
    expect(
      directChatView({
        routeChatId: '10000000',
        listStatus: 'loading',
        chatExists: true,
      }),
    ).toBe('open')
    expect(
      directChatView({
        routeChatId: '10000000',
        listStatus: 'error',
        chatExists: true,
      }),
    ).toBe('open')
  })

  it('marks a missing chat only after a successful load', () => {
    expect(
      directChatView({
        routeChatId: 'missing',
        listStatus: 'ready',
        chatExists: false,
      }),
    ).toBe('missing')
  })

  it('browses the list when the route has no chat id', () => {
    expect(
      directChatView({
        routeChatId: null,
        listStatus: 'ready',
        chatExists: false,
      }),
    ).toBe('browse')
  })

  it('builds a chat path from the string id and skips the same location', () => {
    expect(chatPath('10000000')).toBe('/chats/10000000')
    expect(chatPath('a b')).toBe('/chats/a%20b')
    expect(isChatLocation('/chats/10000000', '10000000')).toBe(true)
    expect(isChatLocation('/chats/10000000', '20000000')).toBe(false)
  })
})
