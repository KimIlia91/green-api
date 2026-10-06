export const toastKinds = ['error', 'success', 'info'] as const

export type ToastKind = (typeof toastKinds)[number]

export type ToastPauseReason = 'pointer' | 'focus' | 'visibility'

export type ToastPhase = 'visible' | 'leaving'

export type ToastInput = {
  kind: ToastKind
  message: string
  dedupeKey?: string
}

export type ToastRecord = {
  id: string
  kind: ToastKind
  message: string
  dedupeKey: string | null
  phase: ToastPhase
  remainingMs: number
  pauses: readonly ToastPauseReason[]
}
