import { describe, expect, it } from 'vitest'

import {
  completeHeaderLeave,
  headerLeaveDelay,
  reduceHeaderPhase,
  type HeaderFace,
  type HeaderPhase,
} from '@/widgets/chat-window/model/header-phase.ts'

const anna: HeaderFace = {
  chatId: '10000000',
  title: 'Анна',
  initials: 'АН',
}

const boris: HeaderFace = {
  chatId: '20000000',
  title: 'Борис с очень длинным именем контакта',
  initials: 'БО',
}

describe('chat header phase', () => {
  it('closes the open header without keeping it as the active chat', () => {
    const leaving = reduceHeaderPhase(open(anna), null, 1)

    expect(leaving).toEqual({ status: 'leaving', face: anna, generation: 1 })
    expect(completeHeaderLeave(leaving, 1)).toEqual({ status: 'idle' })
  })

  it('replaces one open chat with another without a close phase', () => {
    expect(reduceHeaderPhase(open(anna), boris, 2)).toEqual({
      status: 'open',
      face: boris,
    })
  })

  it('drops a stale close when another chat opens', () => {
    const leaving = reduceHeaderPhase(open(anna), null, 1)
    const opened = reduceHeaderPhase(leaving, boris, 2)

    expect(opened).toEqual({ status: 'open', face: boris })
    expect(completeHeaderLeave(opened, 1)).toBe(opened)
  })

  it('ignores a late close completion after the header is already gone', () => {
    const idle: HeaderPhase = { status: 'idle' }
    expect(completeHeaderLeave(idle, 1)).toBe(idle)
  })

  it('skips the close delay when motion is reduced or the token is zero', () => {
    expect(headerLeaveDelay(true, 200)).toBe(0)
    expect(headerLeaveDelay(false, 0)).toBe(0)
    expect(headerLeaveDelay(false, 200)).toBe(200)
  })
})

function open(face: HeaderFace): HeaderPhase {
  return { status: 'open', face }
}
