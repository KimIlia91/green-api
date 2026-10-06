import { beforeEach, describe, expect, it } from 'vitest'

import { loginRedirect } from '@/app/router/session-gate.ts'
import {
  claimChatsReturn,
  isLeaving,
  rememberChatsReturn,
  resetRouteMemory,
  startLeave,
} from '@/app/router/return-path.ts'

describe('chats return path', () => {
  beforeEach(() => {
    resetRouteMemory()
  })

  it('returns to the requested chat after connect', () => {
    const decision = loginRedirect({
      pathname: '/chats/10000000',
      leaving: false,
    })
    expect(decision).toEqual({
      to: '/connection',
      remember: '/chats/10000000',
    })

    if (decision.remember !== null) {
      rememberChatsReturn(decision.remember)
    }

    expect(claimChatsReturn()).toBe('/chats/10000000')
    expect(claimChatsReturn()).toBe('/chats/10000000')
  })

  it('opens the chat list when no return path was saved', () => {
    expect(claimChatsReturn()).toBe('/chats')
  })

  it('rejects external and arbitrary redirect targets', () => {
    const blocked = [
      'https://evil.example/chats/1',
      '//evil.example/chats/1',
      '/connection',
      '/chats/../connection',
      '/chats?next=https://evil.example',
      '/chats/100/extra',
      '/chats/%2e%2e',
      '/chats/%2fsecret',
    ]

    for (const pathname of blocked) {
      const decision = loginRedirect({ pathname, leaving: false })
      expect(decision.remember).toBeNull()
      if (decision.remember !== null) {
        rememberChatsReturn(decision.remember)
      }
    }

    expect(claimChatsReturn()).toBe('/chats')
  })

  it('drops the saved chat route on leave', () => {
    rememberChatsReturn('/chats/10000000')
    startLeave()

    expect(isLeaving()).toBe(true)
    expect(
      loginRedirect({ pathname: '/chats/10000000', leaving: isLeaving() })
        .remember,
    ).toBeNull()
    expect(claimChatsReturn()).toBe('/chats')

    rememberChatsReturn('/chats/10000000')
    expect(claimChatsReturn()).toBe('/chats')
  })

  it('keeps a string chat id without parsing it', () => {
    rememberChatsReturn('/chats/00123')
    expect(claimChatsReturn()).toBe('/chats/00123')
  })
})
