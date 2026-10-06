export type ThreadScrollMetrics = {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

export const threadBottomStickPx = 48
export const jumpShowDistancePx = 60
export const jumpHideDistancePx = 40

export function distanceFromThreadBottom(metrics: ThreadScrollMetrics): number {
  return Math.max(
    0,
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight,
  )
}

export function isNearThreadBottom(distance: number): boolean {
  return distance < threadBottomStickPx
}

export function nextJumpButtonVisible(
  current: boolean,
  metrics: ThreadScrollMetrics,
): boolean {
  const overflow = metrics.scrollHeight - metrics.clientHeight
  if (overflow <= jumpHideDistancePx) {
    return false
  }

  const distance = distanceFromThreadBottom(metrics)
  if (distance >= jumpShowDistancePx) {
    return true
  }

  if (distance <= jumpHideDistancePx) {
    return false
  }

  return current
}
