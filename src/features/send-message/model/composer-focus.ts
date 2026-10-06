const listeners = new Set<() => void>()

export function requestComposerFocus(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeComposerFocus(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
