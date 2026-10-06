import { useEffect, useState } from 'react'

import { millisecondsUntilNextLocalDay } from '@/entities/message'

export function useMessageDayClock(): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let timer = 0
    const refresh = () => {
      setNow(Date.now())
    }
    const schedule = () => {
      timer = window.setTimeout(
        refresh,
        millisecondsUntilNextLocalDay(Date.now()),
      )
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }

    schedule()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [now])

  return now
}
