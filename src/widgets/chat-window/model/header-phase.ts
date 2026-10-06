export type HeaderFace = {
  chatId: string
  title: string
  initials: string
}

export type HeaderPhase =
  | { status: 'idle' }
  | { status: 'open'; face: HeaderFace }
  | { status: 'leaving'; face: HeaderFace; generation: number }

export function reduceHeaderPhase(
  phase: HeaderPhase,
  next: HeaderFace | null,
  generation: number,
): HeaderPhase {
  if (next !== null) {
    return { status: 'open', face: next }
  }
  if (phase.status === 'open') {
    return { status: 'leaving', face: phase.face, generation }
  }
  return phase
}

export function completeHeaderLeave(
  phase: HeaderPhase,
  generation: number,
): HeaderPhase {
  if (phase.status !== 'leaving' || phase.generation !== generation) {
    return phase
  }
  return { status: 'idle' }
}

export function headerLeaveDelay(
  reducedMotion: boolean,
  durationMs: number,
): number {
  if (reducedMotion || !Number.isFinite(durationMs) || durationMs <= 0) {
    return 0
  }
  return durationMs
}
