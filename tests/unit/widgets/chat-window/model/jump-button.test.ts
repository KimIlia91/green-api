import { describe, expect, it } from 'vitest'

import {
  distanceFromThreadBottom,
  isNearThreadBottom,
  jumpHideDistancePx,
  jumpShowDistancePx,
  nextJumpButtonVisible,
  threadBottomStickPx,
  type ThreadScrollMetrics,
} from '@/widgets/chat-window/model/jump-button.ts'

function metrics(
  scrollTop: number,
  clientHeight = 400,
  scrollHeight = 1200,
): ThreadScrollMetrics {
  return { scrollHeight, scrollTop, clientHeight }
}

describe('jump to latest messages', () => {
  it('measures distance from the bottom edge, not the message count', () => {
    expect(distanceFromThreadBottom(metrics(700))).toBe(100)
    expect(distanceFromThreadBottom(metrics(800))).toBe(0)
    expect(distanceFromThreadBottom(metrics(900))).toBe(0)
  })

  it('keeps the existing near-bottom stick threshold', () => {
    expect(threadBottomStickPx).toBe(48)
    expect(isNearThreadBottom(threadBottomStickPx - 1)).toBe(true)
    expect(isNearThreadBottom(threadBottomStickPx)).toBe(false)
  })

  it('hides the button at the bottom and when the thread does not overflow', () => {
    expect(nextJumpButtonVisible(true, metrics(800))).toBe(false)
    expect(nextJumpButtonVisible(true, metrics(0, 400, 400))).toBe(false)
    expect(nextJumpButtonVisible(true, metrics(0, 400, 430))).toBe(false)
  })

  it('shows the button only after the thread is scrolled away from the bottom', () => {
    expect(nextJumpButtonVisible(false, metrics(741))).toBe(false)
    expect(
      nextJumpButtonVisible(false, metrics(800 - jumpShowDistancePx)),
    ).toBe(true)
    expect(nextJumpButtonVisible(false, metrics(0))).toBe(true)
  })

  it('keeps the previous visibility inside the boundary band', () => {
    const between = 800 - (jumpHideDistancePx + jumpShowDistancePx) / 2

    expect(nextJumpButtonVisible(false, metrics(between))).toBe(false)
    expect(nextJumpButtonVisible(true, metrics(between))).toBe(true)
    expect(nextJumpButtonVisible(true, metrics(800 - jumpHideDistancePx))).toBe(
      false,
    )
  })

  it('hides again when a long thread shrinks to the viewport', () => {
    expect(nextJumpButtonVisible(true, metrics(0, 400, 2000))).toBe(true)
    expect(nextJumpButtonVisible(true, metrics(0, 400, 420))).toBe(false)
  })
})
