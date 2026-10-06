import { useEffect, useRef } from 'react'

import styles from './ToastViewport.module.css'

export type ToastNotice = {
  id: string
  kind: 'error' | 'success' | 'info'
  message: string
  phase: 'visible' | 'leaving'
}

type ToastViewportProps = {
  toasts: readonly ToastNotice[]
  onDismiss: (id: string) => void
  onPause: (id: string, reason: 'pointer' | 'focus') => void
  onResume: (id: string, reason: 'pointer' | 'focus') => void
  onExited: (id: string) => void
}

export function ToastViewport({
  toasts,
  onDismiss,
  onPause,
  onResume,
  onExited,
}: ToastViewportProps) {
  const regionRef = useRef<HTMLDivElement>(null)
  const savedFocus = useRef<HTMLElement | null>(null)

  if (toasts.length === 0) {
    return null
  }

  return (
    <div ref={regionRef} className={styles.region}>
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          onDismiss={(keyboard) => {
            if (keyboard) {
              moveFocus(regionRef.current, savedFocus.current, toast.id)
            }
            onDismiss(toast.id)
          }}
          onPause={onPause}
          onResume={onResume}
          onExited={onExited}
          onRememberFocus={(element) => {
            savedFocus.current = element
          }}
        />
      ))}
    </div>
  )
}

function ToastCard({
  toast,
  onDismiss,
  onPause,
  onResume,
  onExited,
  onRememberFocus,
}: {
  toast: ToastNotice
  onDismiss: (keyboard: boolean) => void
  onPause: ToastViewportProps['onPause']
  onResume: ToastViewportProps['onResume']
  onExited: (id: string) => void
  onRememberFocus: (element: HTMLElement) => void
}) {
  useEffect(() => {
    if (toast.phase !== 'leaving') {
      return
    }
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
    onExited(toast.id)
  }, [onExited, toast.id, toast.phase])

  return (
    <article
      className={styles.toast}
      data-kind={toast.kind}
      data-phase={toast.phase}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-hidden={toast.phase === 'leaving' ? true : undefined}
      onPointerEnter={() => {
        onPause(toast.id, 'pointer')
      }}
      onPointerLeave={() => {
        onResume(toast.id, 'pointer')
      }}
      onFocus={(event) => {
        const previous = event.relatedTarget
        const region = event.currentTarget.parentElement
        if (
          previous instanceof HTMLElement &&
          !event.currentTarget.contains(previous) &&
          (region === null || !region.contains(previous))
        ) {
          onRememberFocus(previous)
        }
        onPause(toast.id, 'focus')
      }}
      onBlur={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          onResume(toast.id, 'focus')
        }
      }}
    >
      <p className={styles.message}>{toast.message}</p>
      <button
        type="button"
        className={styles.close}
        data-toast-close=""
        data-toast-id={toast.id}
        aria-label="Закрыть уведомление"
        onClick={(event) => {
          onDismiss(event.detail === 0)
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </article>
  )
}

function moveFocus(
  region: HTMLDivElement | null,
  saved: HTMLElement | null,
  id: string,
): void {
  if (region === null) {
    return
  }

  const buttons = [
    ...region.querySelectorAll<HTMLButtonElement>('[data-toast-close]'),
  ]
  const index = buttons.findIndex((button) => button.dataset.toastId === id)
  const next =
    buttons[index + 1] ?? (index > 0 ? buttons[index - 1] : undefined)
  if (next !== undefined && next.dataset.toastId !== id) {
    next.focus()
    return
  }

  if (saved !== null && saved.isConnected && !region.contains(saved)) {
    saved.focus()
  }
}
