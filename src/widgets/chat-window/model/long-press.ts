export const longPressDelayMs = 500
export const longPressSlopPx = 10

export type PointerHold = {
  chatId: string
  x: number
  y: number
}

export function holdMoved(hold: PointerHold, x: number, y: number): boolean {
  const dx = x - hold.x
  const dy = y - hold.y
  return dx * dx + dy * dy > longPressSlopPx * longPressSlopPx
}

export function shouldOpenHold(
  hold: PointerHold | null,
  chatId: string,
  cancelled: boolean,
): boolean {
  if (hold === null || cancelled || hold.chatId !== chatId) {
    return false
  }
  return true
}
