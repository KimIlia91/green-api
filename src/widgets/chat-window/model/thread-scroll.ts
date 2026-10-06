import { isNearThreadBottom } from './jump-button.ts'

export type ThreadFollow = 'bottom' | 'preserve'

export type ThreadScrollSnapshot = {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

export type ThreadScrollAnchor = {
  height: number
  top: number
}

export function threadScrollportReady(port: {
  clientHeight: number
  visible: boolean
}): boolean {
  return port.visible && port.clientHeight > 0
}

export function bottomScrollTop(port: ThreadScrollSnapshot): number {
  return Math.max(0, port.scrollHeight - port.clientHeight)
}

const threadScrollKeys = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
])

export function isThreadScrollKey(key: string): boolean {
  return threadScrollKeys.has(key)
}

export function nextThreadFollow(
  distance: number,
  programmatic: boolean,
  current: ThreadFollow,
  userMoved = true,
): ThreadFollow {
  if (programmatic || !userMoved) {
    return current
  }

  return isNearThreadBottom(distance) ? 'bottom' : 'preserve'
}

export function quoteScrollTop(input: {
  scrollTop: number
  portTop: number
  portHeight: number
  targetTop: number
  targetHeight: number
  maxScrollTop: number
}): number {
  const delta = input.targetTop - input.portTop
  const centered =
    input.scrollTop + delta - (input.portHeight - input.targetHeight) / 2
  return Math.min(input.maxScrollTop, Math.max(0, centered))
}

export function nextThreadScroll(input: {
  port: ThreadScrollSnapshot
  visible: boolean
  follow: ThreadFollow
  anchor: ThreadScrollAnchor | null
  historyPrepended: boolean
}): { scrollTop: number; applied: boolean } {
  if (
    !threadScrollportReady({
      clientHeight: input.port.clientHeight,
      visible: input.visible,
    })
  ) {
    return { scrollTop: input.port.scrollTop, applied: false }
  }

  if (input.follow === 'bottom') {
    return { scrollTop: bottomScrollTop(input.port), applied: true }
  }

  // Старая история растёт выше якоря, видимая строка остаётся на месте.
  if (input.historyPrepended && input.anchor !== null) {
    const delta = input.port.scrollHeight - input.anchor.height
    return {
      scrollTop: Math.max(0, input.anchor.top + delta),
      applied: true,
    }
  }

  return { scrollTop: input.port.scrollTop, applied: true }
}
