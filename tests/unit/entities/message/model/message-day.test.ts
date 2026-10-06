import { describe, expect, it } from 'vitest'

import { mapHistoryEntry } from '@/entities/message/model/map-history.ts'
import {
  calendarDayKey,
  formatMessageDay,
  millisecondsUntilNextLocalDay,
} from '@/entities/message/model/message-day.ts'

const moscow = 'Europe/Moscow'

describe('formatMessageDay', () => {
  const now = instant(2026, 10, 6, 23, 0, moscow)

  it('uses the calendar day in the given zone, not a 24 hour gap', () => {
    expect(
      formatMessageDay(instant(2026, 10, 6, 0, 30, moscow), now, moscow),
    ).toBe('Сегодня')
    expect(
      formatMessageDay(instant(2026, 10, 5, 1, 0, moscow), now, moscow),
    ).toBe('Вчера')
  })

  it('names another day in the same year and adds the year outside it', () => {
    expect(
      formatMessageDay(
        instant(2026, 10, 5, 12, 0, moscow),
        instant(2026, 10, 7, 12, 0, moscow),
        moscow,
      ),
    ).toBe('5 октября')
    expect(
      formatMessageDay(
        instant(2025, 10, 5, 12, 0, moscow),
        instant(2026, 10, 7, 12, 0, moscow),
        moscow,
      ),
    ).toBe('5 октября 2025')
  })

  it('splits a month boundary and a year boundary', () => {
    const later = instant(2026, 2, 15, 12, 0, moscow)
    expect(
      formatMessageDay(instant(2026, 1, 31, 23, 30, moscow), later, moscow),
    ).toBe('31 января')
    expect(
      formatMessageDay(instant(2026, 2, 1, 0, 30, moscow), later, moscow),
    ).toBe('1 февраля')
    expect(
      formatMessageDay(instant(2025, 12, 31, 23, 30, moscow), later, moscow),
    ).toBe('31 декабря 2025')
    expect(
      formatMessageDay(instant(2026, 1, 1, 0, 30, moscow), later, moscow),
    ).toBe('1 января')
  })

  it('keeps calendar dates across a daylight-saving transition', () => {
    const zone = 'America/New_York'
    const before = Date.parse('2026-03-08T04:30:00Z')
    const after = Date.parse('2026-03-08T05:30:00Z')
    const now = Date.parse('2026-03-10T15:00:00Z')

    expect(calendarDayKey(before, zone)).toBe('2026-03-07')
    expect(calendarDayKey(after, zone)).toBe('2026-03-08')
    expect(formatMessageDay(before, now, zone)).toBe('7 марта')
    expect(formatMessageDay(after, now, zone)).toBe('8 марта')
  })

  it('reads a GREEN-API second timestamp after it is stored as milliseconds', () => {
    const seconds = Math.floor(instant(2025, 10, 5, 12, 0, moscow) / 1000)
    const stored = mapHistoryEntry({
      type: 'incoming',
      idMessage: 'provider-1',
      timestamp: seconds,
      chatId: '10000000',
      typeMessage: 'textMessage',
      text: 'Привет',
      statusMessage: null,
      stickerUrl: null,
      quote: null,
      stickerMimeType: null,
      isEdited: false,
      editedMessageId: null,
      editEvent: null,
      reaction: null,
      deletion: null,
      deleted: false,
      deletedMessageId: null,
      forwarded: false,
      forwardingScore: null,
    })
    expect(stored).not.toBeNull()
    if (stored === null) {
      return
    }

    expect(stored.createdAt).toBe(seconds * 1000)
    expect(
      formatMessageDay(
        stored.createdAt,
        instant(2025, 10, 5, 18, 0, moscow),
        moscow,
      ),
    ).toBe('Сегодня')
  })

  it('waits until the next local midnight', () => {
    const now = instant(2026, 1, 15, 22, 0, moscow)
    expect(millisecondsUntilNextLocalDay(now, moscow)).toBe(2 * 60 * 60 * 1000)
  })
})

function instant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const offset = zoneOffset(guess, timeZone)
  return guess - zoneOffset(guess - offset, timeZone)
}

function zoneOffset(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')
  return (
    Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      read('hour') % 24,
      read('minute'),
      read('second'),
    ) - timestamp
  )
}
