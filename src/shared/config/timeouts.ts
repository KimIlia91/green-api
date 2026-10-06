export const receiveTimeoutMinSeconds = 5
export const receiveTimeoutMaxSeconds = 60

export type RequestTimeouts = {
  requestTimeoutMs: number
  receiveTimeoutSeconds: number
  clientReceiveTimeoutMs: number
  receiveRetryInitialDelayMs: number
  receiveRetryMaxDelayMs: number
}

const defaultRequestTimeouts = {
  requestTimeoutMs: 15_000,
  receiveTimeoutSeconds: 20,
  clientReceiveTimeoutMs: 25_000,
  receiveRetryInitialDelayMs: 1_000,
  receiveRetryMaxDelayMs: 10_000,
} satisfies RequestTimeouts

export function validateRequestTimeouts(
  value: RequestTimeouts,
): RequestTimeouts {
  const problems: string[] = []

  if (!Number.isFinite(value.requestTimeoutMs) || value.requestTimeoutMs <= 0) {
    problems.push('requestTimeoutMs must be a positive finite number')
  }

  if (
    !Number.isInteger(value.receiveTimeoutSeconds) ||
    value.receiveTimeoutSeconds < receiveTimeoutMinSeconds ||
    value.receiveTimeoutSeconds > receiveTimeoutMaxSeconds
  ) {
    problems.push(
      `receiveTimeoutSeconds must be an integer from ${receiveTimeoutMinSeconds} to ${receiveTimeoutMaxSeconds}`,
    )
  }

  if (
    !Number.isFinite(value.clientReceiveTimeoutMs) ||
    value.clientReceiveTimeoutMs <= value.receiveTimeoutSeconds * 1000
  ) {
    problems.push(
      'clientReceiveTimeoutMs must be greater than receiveTimeoutSeconds in milliseconds',
    )
  }

  if (
    !Number.isFinite(value.receiveRetryInitialDelayMs) ||
    value.receiveRetryInitialDelayMs <= 0
  ) {
    problems.push('receiveRetryInitialDelayMs must be a positive finite number')
  }

  if (
    !Number.isFinite(value.receiveRetryMaxDelayMs) ||
    value.receiveRetryMaxDelayMs < value.receiveRetryInitialDelayMs
  ) {
    problems.push(
      'receiveRetryMaxDelayMs must be greater than or equal to receiveRetryInitialDelayMs',
    )
  }

  if (problems.length > 0) {
    throw new Error(`Invalid request timeouts: ${problems.join('; ')}`)
  }

  return value
}

export const requestTimeouts = validateRequestTimeouts(defaultRequestTimeouts)
