const maxPathLength = 512

type RouteMemory = {
  pending: string | null
  claimed: string | null
  leaving: boolean
}

const memory: RouteMemory = {
  pending: null,
  claimed: null,
  leaving: false,
}

export function chatsReturnPath(value: string): string | null {
  if (value.length === 0 || value.length > maxPathLength) {
    return null
  }

  if (!value.startsWith('/') || value.startsWith('//')) {
    return null
  }

  if (
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('://') ||
    value.includes('\0')
  ) {
    return null
  }

  const parts = value.split('/')
  if (parts.length < 2 || parts[0] !== '' || parts[1] !== 'chats') {
    return null
  }

  if (parts.length === 2) {
    return '/chats'
  }

  if (parts.length !== 3) {
    return null
  }

  const segment = parts[2]
  if (segment === '' || segment === '.' || segment === '..') {
    return null
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return null
  }

  if (
    decoded.trim() === '' ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    decoded.includes('..') ||
    decoded.includes('://') ||
    decoded.includes('?') ||
    decoded.includes('#')
  ) {
    return null
  }

  return `/chats/${segment}`
}

export function rememberChatsReturn(pathname: string): void {
  if (memory.leaving) {
    return
  }

  const path = chatsReturnPath(pathname)
  if (path !== null) {
    memory.pending = path
  }
}

export function claimChatsReturn(): string {
  if (memory.claimed !== null) {
    return memory.claimed
  }

  const path = memory.pending ?? '/chats'
  memory.pending = null
  memory.claimed = path
  return path
}

export function releaseClaimedReturn(): void {
  memory.claimed = null
}

export function startLeave(): void {
  memory.leaving = true
  memory.pending = null
  memory.claimed = null
}

export function finishLeave(): void {
  memory.leaving = false
}

export function isLeaving(): boolean {
  return memory.leaving
}

export function resetRouteMemory(): void {
  memory.pending = null
  memory.claimed = null
  memory.leaving = false
}
