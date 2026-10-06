import { useEffect, useState } from 'react'

import {
  completeHeaderLeave,
  headerLeaveDelay,
  reduceHeaderPhase,
  type HeaderFace,
  type HeaderPhase,
} from '../model/header-phase.ts'

export function useLeavingHeader(face: HeaderFace | null): HeaderFace | null {
  const chatId = face?.chatId ?? null
  const [trackedId, setTrackedId] = useState(chatId)
  const [generation, setGeneration] = useState(0)
  const [phase, setPhase] = useState<HeaderPhase>(() =>
    face === null ? { status: 'idle' } : { status: 'open', face },
  )

  if (
    face !== null &&
    phase.status === 'open' &&
    phase.face.chatId === face.chatId &&
    (phase.face.title !== face.title || phase.face.initials !== face.initials)
  ) {
    setPhase({ status: 'open', face })
  }

  if (chatId !== trackedId) {
    const nextGeneration = generation + 1
    const base: HeaderPhase =
      phase.status === 'open' || phase.status === 'leaving'
        ? phase
        : face !== null
          ? { status: 'open', face }
          : { status: 'idle' }
    const next = reduceHeaderPhase(base, face, nextGeneration)
    const delay = headerLeaveDelay(prefersReducedMotion(), durationNormal())
    setTrackedId(chatId)
    setGeneration(nextGeneration)
    if (next.status === 'leaving' && delay > 0) {
      setPhase(next)
    } else {
      setPhase(next.status === 'open' ? next : { status: 'idle' })
    }
  }

  const leavingGeneration = phase.status === 'leaving' ? phase.generation : null

  useEffect(() => {
    if (leavingGeneration === null) {
      return
    }

    const delay = headerLeaveDelay(prefersReducedMotion(), durationNormal())
    const timer = window.setTimeout(() => {
      setPhase((current) => completeHeaderLeave(current, leavingGeneration))
    }, delay)

    return () => {
      window.clearTimeout(timer)
    }
  }, [leavingGeneration])

  if (face !== null || phase.status !== 'leaving') {
    return null
  }

  return phase.face
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function durationNormal(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--duration-normal')
    .trim()
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : 200
}
