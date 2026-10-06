import { describe, expect, it } from 'vitest'

import {
  buildThreadItems,
  type ThreadMessage,
} from '@/widgets/chat-window/model/thread.ts'

const zone = 'Europe/Moscow'
const now = Date.parse('2026-10-06T12:00:00Z')

describe('buildThreadItems', () => {
  it('puts one date before several messages of the same day', () => {
    const items = buildThreadItems(
      [
        message('a', '2026-10-06T06:00:00Z'),
        message('b', '2026-10-06T07:00:00Z'),
        message('c', '2026-10-06T08:00:00Z'),
      ],
      now,
      zone,
    )

    expect(dayLabels(items)).toEqual(['Сегодня'])
    expect(messageIds(items)).toEqual(['a', 'b', 'c'])
  })

  it('starts a new date when the calendar day changes', () => {
    const items = buildThreadItems(
      [
        message('old', '2026-10-04T10:00:00Z'),
        message('yesterday', '2026-10-05T10:00:00Z'),
        message('today', '2026-10-06T08:00:00Z'),
      ],
      now,
      zone,
    )

    expect(dayLabels(items)).toEqual(['4 октября', 'Вчера', 'Сегодня'])
    expect(messageIds(items)).toEqual(['old', 'yesterday', 'today'])
  })

  it('keeps the given order when timestamps are equal', () => {
    const createdAt = Date.parse('2026-10-06T08:00:00Z')
    const items = buildThreadItems(
      [
        { localId: 'first', createdAt },
        { localId: 'second', createdAt },
      ],
      now,
      zone,
    )

    expect(dayLabels(items)).toEqual(['Сегодня'])
    expect(messageIds(items)).toEqual(['first', 'second'])
  })

  it('does not duplicate dates when history and a notice share a day', () => {
    const history: ThreadMessage[] = [
      message('history-old', '2026-10-05T10:00:00Z'),
      message('history-new', '2026-10-06T08:00:00Z'),
    ]
    const withNotice: ThreadMessage[] = [
      ...history,
      message('live', '2026-10-06T09:00:00Z'),
    ]

    const first = buildThreadItems(history, now, zone)
    const merged = buildThreadItems(withNotice, now, zone)
    const reloaded = buildThreadItems(withNotice, now, zone)

    expect(dayKeys(first)).toEqual(['2026-10-05', '2026-10-06'])
    expect(dayKeys(merged)).toEqual(dayKeys(first))
    expect(dayKeys(reloaded)).toEqual(dayKeys(merged))
    expect(messageIds(merged)).toEqual(['history-old', 'history-new', 'live'])
  })
})

function message(localId: string, iso: string): ThreadMessage {
  return { localId, createdAt: Date.parse(iso) }
}

function dayLabels(items: ReturnType<typeof buildThreadItems>): string[] {
  return items.flatMap((item) => (item.kind === 'day' ? [item.label] : []))
}

function dayKeys(items: ReturnType<typeof buildThreadItems>): string[] {
  return items.flatMap((item) => (item.kind === 'day' ? [item.key] : []))
}

function messageIds(items: ReturnType<typeof buildThreadItems>): string[] {
  return items.flatMap((item) =>
    item.kind === 'message' ? [item.localId] : [],
  )
}
