import { describe, expect, it } from 'vitest'

import { homePath, loginRedirect } from '@/app/router/session-gate.ts'

describe('session gate', () => {
  it('sends an anonymous visit to the connection form', () => {
    expect(homePath(false)).toBe('/connection')
    expect(
      loginRedirect({ pathname: '/chats/10000000', leaving: false }),
    ).toEqual({
      to: '/connection',
      remember: '/chats/10000000',
    })
  })

  it('sends an authorized home visit to the chat list', () => {
    expect(homePath(true)).toBe('/chats')
  })

  it('does not remember a chat while leaving', () => {
    expect(
      loginRedirect({ pathname: '/chats/10000000', leaving: true }),
    ).toEqual({
      to: '/connection',
      remember: null,
    })
  })

  it('does not remember an address outside the chat routes', () => {
    expect(
      loginRedirect({
        pathname: 'https://evil.example/steal',
        leaving: false,
      }),
    ).toEqual({
      to: '/connection',
      remember: null,
    })
  })
})
