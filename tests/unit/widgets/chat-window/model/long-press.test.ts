import { describe, expect, it } from 'vitest'

import {
  holdMoved,
  shouldOpenHold,
  type PointerHold,
} from '@/widgets/chat-window/model/long-press.ts'

const hold: PointerHold = { chatId: '10000000', x: 20, y: 40 }

describe('message long press', () => {
  it('does not open after the finger moves past the slop', () => {
    expect(holdMoved(hold, 32, 40)).toBe(true)
    expect(shouldOpenHold(null, hold.chatId, false)).toBe(false)
  })

  it('does not open when the gesture is cancelled', () => {
    expect(holdMoved(hold, 22, 42)).toBe(false)
    expect(shouldOpenHold(hold, hold.chatId, true)).toBe(false)
  })

  it('does not open a hold scheduled for another chat', () => {
    expect(shouldOpenHold(hold, '10000001', false)).toBe(false)
  })

  it('opens when the finger stayed on the same chat', () => {
    expect(holdMoved(hold, 24, 44)).toBe(false)
    expect(shouldOpenHold(hold, hold.chatId, false)).toBe(true)
  })
})
