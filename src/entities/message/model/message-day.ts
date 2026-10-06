export function formatMessageDay(
  createdAt: number,
  now: number,
  timeZone?: string,
): string {
  const day = calendarDayKey(createdAt, timeZone)
  const today = calendarDayKey(now, timeZone)
  if (day === today) {
    return 'Сегодня'
  }
  if (day === shiftDayKey(today, -1)) {
    return 'Вчера'
  }

  const created = calendarParts(createdAt, timeZone)
  const current = calendarParts(now, timeZone)
  const month = monthName(createdAt, timeZone)
  if (created.year === current.year) {
    return `${String(created.day)} ${month}`
  }
  return `${String(created.day)} ${month} ${String(created.year)}`
}

export function calendarDayKey(timestamp: number, timeZone?: string): string {
  const parts = calendarParts(timestamp, timeZone)
  return dayKey(parts.year, parts.month, parts.day)
}

export function millisecondsUntilNextLocalDay(
  now: number,
  timeZone?: string,
): number {
  const next = shiftDayKey(calendarDayKey(now, timeZone), 1)
  const [year, month, day] = next.split('-').map(Number)
  const midnight = localTimeToUtc(
    year ?? 0,
    month ?? 1,
    day ?? 1,
    0,
    0,
    0,
    timeZone,
  )
  const delay = midnight - now
  return delay > 0 ? delay : 60_000
}

function monthName(timestamp: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone,
  }).formatToParts(timestamp)
  return parts.find((part) => part.type === 'month')?.value ?? ''
}

type CalendarParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function calendarParts(timestamp: number, timeZone?: string): CalendarParts {
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
  return {
    year: numberPart(parts, 'year'),
    month: numberPart(parts, 'month'),
    day: numberPart(parts, 'day'),
    hour: numberPart(parts, 'hour') % 24,
    minute: numberPart(parts, 'minute'),
    second: numberPart(parts, 'second'),
  }
}

function numberPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = parts.find((part) => part.type === type)?.value ?? '0'
  return Number(value)
}

function dayKey(year: number, month: number, day: number): string {
  return `${String(year)}-${pad(month)}-${pad(day)}`
}

function shiftDayKey(key: string, delta: number): string {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1))
  date.setUTCDate(date.getUTCDate() + delta)
  return dayKey(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  )
}

function localTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone?: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const instant = guess - zoneOffset(guess, timeZone)
  return guess - zoneOffset(instant, timeZone)
}

function zoneOffset(timestamp: number, timeZone?: string): number {
  const parts = calendarParts(timestamp, timeZone)
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) - timestamp
  )
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
