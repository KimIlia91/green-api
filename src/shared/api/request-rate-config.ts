const defaultIntervalsMs = {
  getStateInstance: 1200,
  getChats: 1200,
  getChatHistory: 1200,
  readChat: 1200,
  deleteMessage: 1200,
  checkAccount: 120,
  getContactInfo: 120,
  sendMessage: 24,
  editMessage: 24,
  forwardMessages: 24,
  receiveNotification: 12,
  deleteNotification: 12,
} as const

const intervalsMs = new Map<string, number>(Object.entries(defaultIntervalsMs))

export function requestRateIntervalMs(method: string): number {
  return intervalsMs.get(method) ?? 0
}

export function setRequestRateInterval(
  method: string,
  intervalMs: number,
): void {
  intervalsMs.set(method, intervalMs)
}

export function resetRequestRateIntervals(): void {
  intervalsMs.clear()
  for (const [method, intervalMs] of Object.entries(defaultIntervalsMs)) {
    intervalsMs.set(method, intervalMs)
  }
}
