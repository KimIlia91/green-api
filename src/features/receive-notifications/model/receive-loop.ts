import { sessionIdentity, useSessionStore } from '@/entities/session'
import { createGreenApiClient, GreenApiError } from '@/shared/api'
import type { GreenApiClient } from '@/shared/api'
import { requestTimeouts } from '@/shared/config'

import { applyNotification } from './apply-notification.ts'

type ReceiveClient = Pick<
  GreenApiClient,
  'receiveNotification' | 'deleteNotification'
>

type Sleep = (ms: number, signal: AbortSignal) => Promise<void>

export type ReceiveLoopOptions = {
  client?: ReceiveClient
  sleep?: Sleep
  retryInitialDelayMs?: number
  retryMaxDelayMs?: number
  createId?: () => string
}

type ActiveLoop = {
  generation: number
  key: string
  controller: AbortController
}

let generation = 0
let active: ActiveLoop | null = null

export function startReceiveLoop(options: ReceiveLoopOptions = {}): void {
  const connection = useSessionStore.getState().connection
  if (connection === null) {
    return
  }

  const key = sessionIdentity(connection)
  if (key === '') {
    return
  }

  if (
    active !== null &&
    active.key === key &&
    !active.controller.signal.aborted
  ) {
    return
  }

  const nextGeneration = ++generation
  active?.controller.abort()
  const controller = new AbortController()
  active = { generation: nextGeneration, key, controller }
  const client = options.client ?? createGreenApiClient(connection)

  void runLoop({
    client,
    key,
    generation: nextGeneration,
    signal: controller.signal,
    sleep: options.sleep ?? delay,
    initialDelay:
      options.retryInitialDelayMs ?? requestTimeouts.receiveRetryInitialDelayMs,
    maxDelay: options.retryMaxDelayMs ?? requestTimeouts.receiveRetryMaxDelayMs,
    createId: options.createId,
  })
}

export function stopReceiveLoop(): void {
  generation += 1
  active?.controller.abort()
  active = null
}

type RunLoopInput = {
  client: ReceiveClient
  key: string
  generation: number
  signal: AbortSignal
  sleep: Sleep
  initialDelay: number
  maxDelay: number
  createId?: () => string
}

async function runLoop(input: RunLoopInput): Promise<void> {
  let delayMs = input.initialDelay
  let repeatedReceiptId: number | null = null

  while (isCurrent(input.generation, input.key)) {
    try {
      const notification = await input.client.receiveNotification({
        signal: input.signal,
      })
      if (!isCurrent(input.generation, input.key)) {
        return
      }

      if (notification !== null) {
        applyNotification(notification.body, { createId: input.createId })
        if (!isCurrent(input.generation, input.key)) {
          return
        }
        const deleted = await input.client.deleteNotification(
          notification.receiptId,
          { signal: input.signal },
        )
        if (!isCurrent(input.generation, input.key)) {
          return
        }

        if (!deleted.result) {
          if (repeatedReceiptId === notification.receiptId) {
            await input.sleep(delayMs, input.signal)
            if (!isCurrent(input.generation, input.key)) {
              return
            }
            delayMs = Math.min(delayMs * 2, input.maxDelay)
          } else {
            repeatedReceiptId = notification.receiptId
          }
          continue
        }

        repeatedReceiptId = null
      }

      if (!isCurrent(input.generation, input.key)) {
        return
      }

      delayMs = input.initialDelay
      repeatedReceiptId = null
    } catch (error) {
      if (
        !isCurrent(input.generation, input.key) ||
        input.signal.aborted ||
        isAbort(error)
      ) {
        return
      }

      try {
        await input.sleep(delayMs, input.signal)
      } catch {
        return
      }

      if (!isCurrent(input.generation, input.key)) {
        return
      }

      delayMs = Math.min(delayMs * 2, input.maxDelay)
    }
  }
}

function isCurrent(generationId: number, key: string): boolean {
  return (
    active?.generation === generationId &&
    active.key === key &&
    !active.controller.signal.aborted &&
    sessionIdentity(useSessionStore.getState().connection) === key
  )
}

function isAbort(error: unknown): boolean {
  return error instanceof GreenApiError && error.kind === 'abort'
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new GreenApiError('abort', 'The receive retry was cancelled'))
      return
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new GreenApiError('abort', 'The receive retry was cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
