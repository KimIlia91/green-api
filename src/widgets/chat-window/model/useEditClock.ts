import { useLayoutEffect, useState } from 'react'

import { editDeadline, useMessageStore } from '@/entities/message'

export function useEditClock(localIds: readonly (string | null)[]): number {
  const [now, setNow] = useState(() => Date.now())
  const activeKey = localIds
    .filter((id): id is string => id !== null)
    .join('\0')

  useLayoutEffect(() => {
    if (activeKey === '') {
      return
    }

    let timer = 0
    const schedule = () => {
      window.clearTimeout(timer)
      const messages = useMessageStore.getState().messagesById
      const future = activeKey
        .split('\0')
        .map((id) => editDeadline(messages[id]?.sentAt))
        .filter(
          (deadline): deadline is number =>
            deadline !== null && deadline > Date.now(),
        )
      if (future.length === 0) {
        return
      }

      timer = window.setTimeout(
        () => {
          setNow(Date.now())
          schedule()
        },
        Math.min(...future) - Date.now(),
      )
    }
    const refresh = () => {
      setNow(Date.now())
      schedule()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }

    document.addEventListener('visibilitychange', onVisible)
    refresh()
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearTimeout(timer)
    }
  }, [activeKey])

  return now
}
