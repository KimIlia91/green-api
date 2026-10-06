export type TariffLimitKind = 'chats' | 'method' | 'both' | 'unrecognized'

const methodExceededStatuses = new Set(['QUOTE_EXCEEDED', 'QUOTA_EXCEEDED'])

const chatExceededStatuses = new Set([
  'CORRESPONDENTS_QUOTA_EXCEEDED',
  'CORRESPONDENTS_QUOTE_EXCEEDED',
  'QUOTE_EXCEEDED',
  'QUOTA_EXCEEDED',
])

export function classifyTariffLimit(body: unknown): TariffLimitKind {
  if (!isRecord(body)) {
    return 'unrecognized'
  }

  const chats =
    hasStatus(body.correspondentsStatus, chatExceededStatuses) ||
    hasStatus(body.quotaData, chatExceededStatuses)
  const method = hasStatus(body.invokeStatus, methodExceededStatuses)

  if (chats && method) {
    return 'both'
  }
  if (chats) {
    return 'chats'
  }
  if (method) {
    return 'method'
  }
  return 'unrecognized'
}

function hasStatus(value: unknown, statuses: ReadonlySet<string>): boolean {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return false
  }

  return statuses.has(value.status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
