import { readStoredCredentials } from '@/entities/session'
import type { GreenApiClient } from '@/shared/api'

import {
  connectToInstance,
  type ConnectOutcome,
} from './connect-to-instance.ts'

export type RestoreOutcome = ConnectOutcome | { status: 'absent' }

type RestoreClient = Pick<GreenApiClient, 'getStateInstance'>

let generation = 0
let active: AbortController | null = null
let inflight: Promise<RestoreOutcome> | null = null

export function cancelConnectionRestore(): void {
  generation += 1
  active?.abort()
  active = null
  inflight = null
}

export function restoreStoredConnection(
  client?: RestoreClient,
): Promise<RestoreOutcome> {
  const stored = readStoredCredentials()
  if (stored === null) {
    return Promise.resolve({ status: 'absent' })
  }

  if (inflight !== null) {
    return inflight
  }

  const attempt = ++generation
  const controller = new AbortController()
  active = controller
  const settled = connectToInstance({
    draft: stored,
    signal: controller.signal,
    isStale: () => attempt !== generation,
    client,
  }).then((outcome): RestoreOutcome => {
    if (attempt !== generation || controller.signal.aborted) {
      return { status: 'ignored' }
    }

    return outcome
  })
  const request: Promise<RestoreOutcome> = settled.finally(() => {
    if (inflight === request) {
      inflight = null
    }
  })
  inflight = request

  return request
}

export function watchConnectionRestore(
  onOutcome: (outcome: RestoreOutcome) => void,
  client?: RestoreClient,
): () => void {
  let activeWatch = true
  void restoreStoredConnection(client).then((outcome) => {
    if (!activeWatch || outcome.status === 'ignored') {
      return
    }

    onOutcome(outcome)
  })

  return () => {
    activeWatch = false
  }
}
