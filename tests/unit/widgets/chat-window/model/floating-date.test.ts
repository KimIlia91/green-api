import { describe, expect, it } from 'vitest'

import { formatMessageDay } from '@/entities/message'

import {
  nextFloatingDate,
  type DayMarker,
  type FloatingDate,
} from '@/widgets/chat-window/model/floating-date.ts'

const top = 100

describe('nextFloatingDate', () => {
  it('returns nothing when the thread has no days', () => {
    expect(nextFloatingDate(null, [], top)).toBeNull()
  })

  it('hides the chip while the only separator is still in view', () => {
    expect(nextFloatingDate(null, [day('Сегодня', 120, 148)], top)).toEqual({
      label: 'Сегодня',
      shown: false,
    })
  })

  it('shows the day once its separator has left the scrollport', () => {
    expect(nextFloatingDate(null, [day('Сегодня', 40, 68)], top)).toEqual({
      label: 'Сегодня',
      shown: true,
    })
  })

  it('uses the day of a message cut by the top edge', () => {
    const markers = [
      day('4 октября', 0, 28),
      day('Вчера', 640, 668),
      day('Сегодня', 1200, 1228),
    ]

    expect(nextFloatingDate(null, markers, 400)).toEqual({
      label: '4 октября',
      shown: true,
    })
  })

  it('keeps the current day across the gap before the next separator', () => {
    const markers = [day('Вчера', 20, 48), day('Сегодня', 900, 928)]

    expect(nextFloatingDate(null, markers, 700)).toEqual({
      label: 'Вчера',
      shown: true,
    })
  })

  it('keeps a tall day until the next separator reaches the top edge', () => {
    const markers = [day('Вчера', -800, -772), day('Сегодня', 2400, 2428)]
    const shown: FloatingDate = { label: 'Вчера', shown: true }

    expect(nextFloatingDate(shown, markers, 900)).toEqual(shown)
  })

  it('hides the copy while the same separator crosses the top edge', () => {
    const markers = [day('Вчера', -200, -172), day('Сегодня', 80, 120)]
    const current: FloatingDate = { label: 'Вчера', shown: true }

    expect(nextFloatingDate(current, markers, top)).toEqual({
      label: 'Вчера',
      shown: false,
    })
  })

  it('shows the upper day while a later separator stays lower in the thread', () => {
    const markers = [day('Вчера', 10, 38), day('Сегодня', 520, 548)]

    expect(nextFloatingDate(null, markers, 200)).toEqual({
      label: 'Вчера',
      shown: true,
    })
  })

  it('switches the label after the next day separator has left', () => {
    const markers = [day('Вчера', -400, -372), day('Сегодня', 40, 68)]
    const hidden: FloatingDate = { label: 'Вчера', shown: false }

    expect(nextFloatingDate(hidden, markers, top)).toEqual({
      label: 'Сегодня',
      shown: true,
    })
  })

  it('changes the label in place when the calendar day rolls over', () => {
    const createdAt = Date.parse('2026-10-06T08:00:00Z')
    const zone = 'Europe/Moscow'
    const today = formatMessageDay(
      createdAt,
      Date.parse('2026-10-06T12:00:00Z'),
      zone,
    )
    const nextDay = formatMessageDay(
      createdAt,
      Date.parse('2026-10-07T12:00:00Z'),
      zone,
    )
    const shown = nextFloatingDate(null, [day(today, 20, 48)], top)

    expect(today).toBe('Сегодня')
    expect(nextDay).toBe('Вчера')
    expect(nextFloatingDate(shown, [day(nextDay, 20, 48)], top)).toEqual({
      label: 'Вчера',
      shown: true,
    })
  })
})

function day(
  label: string,
  separatorTop: number,
  separatorBottom: number,
): DayMarker {
  return { label, separatorTop, separatorBottom }
}
