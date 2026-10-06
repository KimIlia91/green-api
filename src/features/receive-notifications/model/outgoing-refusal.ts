export type OutgoingSendRefusal = {
  localId: string
  status: 'failed' | 'noAccount' | 'notInGroup'
}

type OutgoingSendRefusalListener = (refusal: OutgoingSendRefusal) => void

let listener: OutgoingSendRefusalListener | null = null

export function bindOutgoingSendRefusal(
  next: OutgoingSendRefusalListener | null,
): void {
  listener = next
}

export function publishOutgoingSendRefusal(refusal: OutgoingSendRefusal): void {
  listener?.(refusal)
}
