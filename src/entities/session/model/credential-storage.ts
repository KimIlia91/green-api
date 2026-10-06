import type { SessionConnection } from './types.ts'

export const sessionCredentialStorageKey = 'green-api.connection'

export function readStoredCredentials(): SessionConnection | null {
  const storage = storageOrNull()
  if (storage === null) {
    return null
  }

  let raw: string | null
  try {
    raw = storage.getItem(sessionCredentialStorageKey)
  } catch {
    return null
  }

  if (raw === null) {
    return null
  }

  const parsed = parseStoredCredentials(raw)
  if (parsed === null) {
    clearStoredCredentials()
    return null
  }

  return parsed
}

export function writeStoredCredentials(connection: SessionConnection): void {
  const storage = storageOrNull()
  if (storage === null) {
    return
  }

  try {
    storage.setItem(
      sessionCredentialStorageKey,
      JSON.stringify({
        apiUrl: connection.apiUrl,
        idInstance: connection.idInstance,
        apiTokenInstance: connection.apiTokenInstance,
      }),
    )
  } catch {
    // Сессия в памяти остаётся рабочей, когда хранилище недоступно.
  }
}

export function clearStoredCredentials(): void {
  const storage = storageOrNull()
  if (storage === null) {
    return
  }

  try {
    storage.removeItem(sessionCredentialStorageKey)
  } catch {
    // Очистка памяти завершается, даже если хранилище недоступно.
  }
}

function storageOrNull(): Storage | null {
  try {
    const storage = globalThis.sessionStorage
    if (!storage) {
      return null
    }

    return storage
  } catch {
    return null
  }
}

function parseStoredCredentials(raw: string): SessionConnection | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const apiUrl = credentialString(record.apiUrl)
  const idInstance = credentialString(record.idInstance)
  const apiTokenInstance = credentialString(record.apiTokenInstance)
  if (apiUrl === null || idInstance === null || apiTokenInstance === null) {
    return null
  }

  return { apiUrl, idInstance, apiTokenInstance }
}

function credentialString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }

  return trimmed
}
