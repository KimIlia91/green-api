import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearToasts,
  dismissToast,
  finishToastExit,
  pauseToast,
  pauseToasts,
  resetToastStore,
  resumeToast,
  resumeToasts,
  resumeToastTimers,
  showToast,
  suspendToastTimers,
  toastDurationMs,
  toastExitMs,
  toastLimit,
  useToastStore,
} from '@/shared/lib/toast/toast-store.ts'

describe('toast store', () => {
  beforeEach(() => {
    resetToastStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetToastStore()
    vi.useRealTimers()
  })

  it('shows a toast and closes it automatically', () => {
    const id = showToast({ kind: 'error', message: 'Сеть' })

    expect(useToastStore.getState().toasts).toMatchObject([
      { id, kind: 'error', message: 'Сеть', phase: 'visible' },
    ])

    vi.advanceTimersByTime(toastDurationMs - 1)
    expect(useToastStore.getState().toasts[0]?.phase).toBe('visible')

    vi.advanceTimersByTime(1)
    expect(useToastStore.getState().toasts[0]?.phase).toBe('leaving')

    vi.advanceTimersByTime(toastExitMs)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('updates a toast with the same key instead of adding another', () => {
    const first = showToast({
      kind: 'info',
      message: 'Первое',
      dedupeKey: 'sync',
    })
    vi.advanceTimersByTime(toastDurationMs - 1)

    const second = showToast({
      kind: 'success',
      message: 'Второе',
      dedupeKey: 'sync',
    })

    expect(second).toBe(first)
    expect(useToastStore.getState().toasts).toMatchObject([
      { id: first, kind: 'success', message: 'Второе', phase: 'visible' },
    ])

    vi.advanceTimersByTime(toastDurationMs - 1)
    expect(useToastStore.getState().toasts[0]?.phase).toBe('visible')
    vi.advanceTimersByTime(1)
    expect(useToastStore.getState().toasts[0]?.phase).toBe('leaving')
  })

  it('keeps at most three toasts by dropping the oldest', () => {
    const ids = ['one', 'two', 'three', 'four'].map((message) =>
      showToast({ kind: 'info', message }),
    )

    expect(useToastStore.getState().toasts.map((toast) => toast.id)).toEqual(
      ids.slice(1),
    )
    expect(useToastStore.getState().toasts).toHaveLength(toastLimit)

    vi.advanceTimersByTime(toastDurationMs + toastExitMs)
    expect(
      useToastStore.getState().toasts.map((toast) => toast.message),
    ).toEqual([])
    expect(ids[0]).toBe('toast-1')
  })

  it('does not treat a failed close as success and does not keep a cleared timer', () => {
    const id = showToast({ kind: 'info', message: 'Жду' })
    dismissToast(id)
    expect(useToastStore.getState().toasts[0]?.phase).toBe('leaving')
    finishToastExit(id)
    expect(useToastStore.getState().toasts).toEqual([])

    showToast({ kind: 'success', message: 'Осталось' })
    clearToasts()
    vi.advanceTimersByTime(toastDurationMs + toastExitMs)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('pauses the timer while hovered, focused, or the tab is hidden', () => {
    const id = showToast({ kind: 'info', message: 'Пауза' })
    vi.advanceTimersByTime(3_000)
    pauseToast(id, 'pointer')
    pauseToast(id, 'focus')
    vi.advanceTimersByTime(toastDurationMs)
    expect(useToastStore.getState().toasts[0]?.phase).toBe('visible')

    resumeToast(id, 'pointer')
    vi.advanceTimersByTime(toastDurationMs)
    expect(useToastStore.getState().toasts[0]?.phase).toBe('visible')

    resumeToast(id, 'focus')
    vi.advanceTimersByTime(toastDurationMs - 3_000 - 1)
    expect(useToastStore.getState().toasts[0]?.phase).toBe('visible')
    vi.advanceTimersByTime(1)
    expect(useToastStore.getState().toasts[0]?.phase).toBe('leaving')
  })

  it('pauses every open toast when the tab is hidden', () => {
    showToast({ kind: 'error', message: 'Один' })
    showToast({ kind: 'success', message: 'Два' })
    vi.advanceTimersByTime(1_000)
    pauseToasts('visibility')
    vi.advanceTimersByTime(toastDurationMs)
    expect(useToastStore.getState().toasts.map((toast) => toast.phase)).toEqual(
      ['visible', 'visible'],
    )

    resumeToasts('visibility')
    vi.advanceTimersByTime(toastDurationMs - 1_000)
    expect(useToastStore.getState().toasts.map((toast) => toast.phase)).toEqual(
      ['leaving', 'leaving'],
    )
  })

  it('cancels timers on suspend and rearms the remaining time', () => {
    showToast({ kind: 'info', message: 'Живой' })
    vi.advanceTimersByTime(2_000)
    suspendToastTimers()
    vi.advanceTimersByTime(toastDurationMs)
    expect(useToastStore.getState().toasts[0]?.phase).toBe('visible')

    resumeToastTimers()
    vi.advanceTimersByTime(toastDurationMs - 2_000)
    expect(useToastStore.getState().toasts[0]?.phase).toBe('leaving')
  })

  it('reopens a leaving toast when the same key arrives again', () => {
    const id = showToast({
      kind: 'error',
      message: 'Сбой',
      dedupeKey: 'send',
    })
    dismissToast(id)
    showToast({
      kind: 'error',
      message: 'Сбой снова',
      dedupeKey: 'send',
    })

    expect(useToastStore.getState().toasts).toMatchObject([
      { id, message: 'Сбой снова', phase: 'visible' },
    ])
    vi.advanceTimersByTime(toastExitMs)
    expect(useToastStore.getState().toasts[0]?.phase).toBe('visible')
  })
})
