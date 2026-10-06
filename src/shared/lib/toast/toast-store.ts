import { create } from 'zustand'

import type {
  ToastInput,
  ToastPauseReason,
  ToastRecord,
} from './toast-types.ts'

export const toastDurationMs = 8000
export const toastExitMs = 200
export const toastLimit = 3

type ToastState = {
  toasts: readonly ToastRecord[]
}

const handles = new Map<string, ReturnType<typeof setTimeout>>()
const deadlines = new Map<string, number>()
const globalPauses = new Set<ToastPauseReason>()

let sequence = 0

export const useToastStore = create<ToastState>()(() => ({
  toasts: [],
}))

export function showToast(input: ToastInput): string {
  const dedupeKey = input.dedupeKey ?? null
  if (dedupeKey !== null) {
    const existing = useToastStore
      .getState()
      .toasts.find((toast) => toast.dedupeKey === dedupeKey)
    if (existing !== undefined) {
      return updateToast(existing, input, dedupeKey)
    }
  }

  const current = useToastStore.getState().toasts
  const oldest = current.length >= toastLimit ? current[0] : undefined
  if (oldest !== undefined) {
    disarm(oldest.id)
  }
  const id = nextId()
  const pauses = [...globalPauses]
  useToastStore.setState({
    toasts: [
      ...(oldest === undefined ? current : current.slice(1)),
      {
        id,
        kind: input.kind,
        message: input.message,
        dedupeKey,
        phase: 'visible',
        remainingMs: toastDurationMs,
        pauses,
      },
    ],
  })
  if (pauses.length === 0) {
    armAuto(id, toastDurationMs)
  }
  return id
}

export function dismissToast(id: string): void {
  const toast = findToast(id)
  if (toast === undefined || toast.phase === 'leaving') {
    return
  }

  disarm(id)
  replaceToast(id, { ...toast, phase: 'leaving' })
  armExit(id)
}

export function clearToasts(): void {
  disarmAll()
  useToastStore.setState({ toasts: [] })
}

export function pauseToast(id: string, reason: ToastPauseReason): void {
  const toast = findToast(id)
  if (toast === undefined || toast.phase !== 'visible') {
    return
  }
  if (toast.pauses.includes(reason)) {
    return
  }

  const remainingMs = timeLeft(toast)
  disarm(id)
  replaceToast(id, {
    ...toast,
    remainingMs,
    pauses: [...toast.pauses, reason],
  })
}

export function resumeToast(id: string, reason: ToastPauseReason): void {
  const toast = findToast(id)
  if (toast === undefined || !toast.pauses.includes(reason)) {
    return
  }

  const pauses = toast.pauses.filter((item) => item !== reason)
  replaceToast(id, { ...toast, pauses })
  if (pauses.length === 0 && toast.phase === 'visible') {
    armAuto(id, toast.remainingMs)
  }
}

export function pauseToasts(reason: ToastPauseReason): void {
  globalPauses.add(reason)
  for (const toast of useToastStore.getState().toasts) {
    pauseToast(toast.id, reason)
  }
}

export function resumeToasts(reason: ToastPauseReason): void {
  globalPauses.delete(reason)
  for (const toast of useToastStore.getState().toasts) {
    resumeToast(toast.id, reason)
  }
}

export function finishToastExit(id: string): void {
  const toast = findToast(id)
  if (toast === undefined || toast.phase !== 'leaving') {
    return
  }

  disarm(id)
  useToastStore.setState((state) => ({
    toasts: state.toasts.filter((item) => item.id !== id),
  }))
}

export function suspendToastTimers(): void {
  const next = useToastStore.getState().toasts.map((toast) => {
    if (toast.phase !== 'visible') {
      return toast
    }
    return { ...toast, remainingMs: timeLeft(toast) }
  })
  disarmAll()
  useToastStore.setState({ toasts: next })
}

export function resumeToastTimers(): void {
  for (const toast of useToastStore.getState().toasts) {
    if (handles.has(toast.id)) {
      continue
    }
    if (toast.phase === 'leaving') {
      armExit(toast.id)
      continue
    }
    if (toast.pauses.length === 0) {
      armAuto(toast.id, toast.remainingMs)
    }
  }
}

export function resetToastStore(): void {
  disarmAll()
  globalPauses.clear()
  sequence = 0
  useToastStore.setState({ toasts: [] })
}

function updateToast(
  existing: ToastRecord,
  input: ToastInput,
  dedupeKey: string,
): string {
  const pauses = mergePauses(existing.pauses, globalPauses)
  const next = {
    ...existing,
    kind: input.kind,
    message: input.message,
    dedupeKey,
    phase: 'visible' as const,
    remainingMs: toastDurationMs,
    pauses,
  }
  replaceToast(existing.id, next)
  if (pauses.length === 0) {
    armAuto(existing.id, toastDurationMs)
  } else {
    disarm(existing.id)
  }
  return existing.id
}

function armAuto(id: string, remainingMs: number): void {
  disarm(id)
  deadlines.set(id, Date.now() + remainingMs)
  handles.set(
    id,
    setTimeout(() => {
      handles.delete(id)
      deadlines.delete(id)
      dismissToast(id)
    }, remainingMs),
  )
}

function armExit(id: string): void {
  disarm(id)
  handles.set(
    id,
    setTimeout(() => {
      handles.delete(id)
      finishToastExit(id)
    }, toastExitMs),
  )
}

function timeLeft(toast: ToastRecord): number {
  const deadline = deadlines.get(toast.id)
  if (deadline === undefined) {
    return toast.remainingMs
  }
  return Math.max(0, deadline - Date.now())
}

function findToast(id: string): ToastRecord | undefined {
  return useToastStore.getState().toasts.find((toast) => toast.id === id)
}

function replaceToast(id: string, next: ToastRecord): void {
  useToastStore.setState((state) => ({
    toasts: state.toasts.map((toast) => (toast.id === id ? next : toast)),
  }))
}

function disarm(id: string): void {
  const handle = handles.get(id)
  if (handle !== undefined) {
    clearTimeout(handle)
  }
  handles.delete(id)
  deadlines.delete(id)
}

function disarmAll(): void {
  for (const handle of handles.values()) {
    clearTimeout(handle)
  }
  handles.clear()
  deadlines.clear()
}

function mergePauses(
  current: readonly ToastPauseReason[],
  extra: ReadonlySet<ToastPauseReason>,
): ToastPauseReason[] {
  const pauses = [...current]
  for (const reason of extra) {
    if (!pauses.includes(reason)) {
      pauses.push(reason)
    }
  }
  return pauses
}

function nextId(): string {
  sequence += 1
  return `toast-${String(sequence)}`
}
