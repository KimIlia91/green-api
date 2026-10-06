import { useEffect } from 'react'

import { ToastViewport } from '../../ui/index.ts'

import {
  dismissToast,
  finishToastExit,
  pauseToast,
  pauseToasts,
  resumeToast,
  resumeToasts,
  resumeToastTimers,
  suspendToastTimers,
  useToastStore,
} from './toast-store.ts'

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts)
  useToastLifetime()

  return (
    <ToastViewport
      toasts={toasts}
      onDismiss={dismissToast}
      onPause={pauseToast}
      onResume={resumeToast}
      onExited={finishToastExit}
    />
  )
}

function useToastLifetime(): void {
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pauseToasts('visibility')
        return
      }
      resumeToasts('visibility')
    }

    document.addEventListener('visibilitychange', onVisibility)
    if (document.visibilityState === 'hidden') {
      pauseToasts('visibility')
    }
    resumeToastTimers()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      suspendToastTimers()
    }
  }, [])
}
