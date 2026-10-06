import { describe, expect, it } from 'vitest'

import { hidesMessageActionButton } from '@/widgets/chat-window/model/message-actions.ts'

describe('message action button', () => {
  it('hides the button on a narrow screen even when a pointer can hover', () => {
    expect(hidesMessageActionButton({ narrow: true, hoverNone: false })).toBe(
      true,
    )
  })

  it('hides the button on a wide touch screen without hover', () => {
    expect(hidesMessageActionButton({ narrow: false, hoverNone: true })).toBe(
      true,
    )
  })

  it('keeps the hover button on a wide screen with a fine pointer', () => {
    expect(hidesMessageActionButton({ narrow: false, hoverNone: false })).toBe(
      false,
    )
  })
})
