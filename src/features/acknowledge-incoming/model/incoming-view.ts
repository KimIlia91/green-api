export type IncomingReadCandidate = {
  providerId: string
  direction: 'incoming' | 'outgoing'
}

export function latestIncomingReadTarget(input: {
  documentVisible: boolean
  conversationVisible: boolean
  ordered: readonly IncomingReadCandidate[]
  visibleProviderIds: readonly string[]
}): string | null {
  if (!input.documentVisible || !input.conversationVisible) {
    return null
  }

  const visible = new Set(input.visibleProviderIds)
  let latest: string | null = null
  for (const item of input.ordered) {
    if (item.direction !== 'incoming') {
      continue
    }
    const providerId = item.providerId.trim()
    if (providerId === '' || !visible.has(providerId)) {
      continue
    }
    latest = providerId
  }
  return latest
}

export function incomingIdsInView(input: {
  documentVisible: boolean
  conversationVisible: boolean
  unseenIds: readonly string[]
  visibleMessageIds: readonly string[]
}): string[] {
  if (!input.documentVisible || !input.conversationVisible) {
    return []
  }

  const visible = new Set(input.visibleMessageIds)
  return input.unseenIds.filter((id) => visible.has(id))
}
