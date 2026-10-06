import { calendarDayKey, formatMessageDay } from '@/entities/message'

export type ThreadMessage = {
  localId: string
  createdAt: number
}

export type ThreadEntry =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; localId: string }

export function buildThreadItems(
  messages: readonly ThreadMessage[],
  now: number,
  timeZone?: string,
): ThreadEntry[] {
  const items: ThreadEntry[] = []
  let previousKey = ''

  for (const message of messages) {
    const key = calendarDayKey(message.createdAt, timeZone)
    if (key !== previousKey) {
      items.push({
        kind: 'day',
        key,
        label: formatMessageDay(message.createdAt, now, timeZone),
      })
      previousKey = key
    }
    items.push({ kind: 'message', localId: message.localId })
  }

  return items
}
