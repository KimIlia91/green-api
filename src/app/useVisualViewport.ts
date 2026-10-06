import { useEffect } from 'react'

export function useVisualViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (viewport === null) {
      return
    }

    const root = document.documentElement
    const sync = () => {
      root.style.setProperty('--visual-viewport-height', `${viewport.height}px`)
      root.style.setProperty(
        '--visual-viewport-offset',
        `${viewport.offsetTop}px`,
      )
    }

    sync()
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
      root.style.removeProperty('--visual-viewport-height')
      root.style.removeProperty('--visual-viewport-offset')
    }
  }, [])
}
