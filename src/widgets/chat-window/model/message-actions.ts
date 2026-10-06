import { useEffect, useState } from 'react'

/** То же условие, что у кнопки действий сообщения в стилях чата. */
export const messageActionButtonQuery = '(hover: none), (max-width: 925px)'

export function hidesMessageActionButton(input: {
  narrow: boolean
  hoverNone: boolean
}): boolean {
  return input.narrow || input.hoverNone
}

export function useHidesMessageActionButton(): boolean {
  const [hides, setHides] = useState(
    () => window.matchMedia(messageActionButtonQuery).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(messageActionButtonQuery)
    const onChange = (event: MediaQueryListEvent) => {
      setHides(event.matches)
    }
    media.addEventListener('change', onChange)
    return () => {
      media.removeEventListener('change', onChange)
    }
  }, [])

  return hides
}
