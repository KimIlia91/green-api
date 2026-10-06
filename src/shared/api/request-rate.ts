import { GreenApiError } from './errors.ts'
import {
  requestRateIntervalMs,
  resetRequestRateIntervals,
} from './request-rate-config.ts'

type ScheduledTask = {
  signal: AbortSignal
  run: (signal: AbortSignal) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  onAbort: () => void
}

type RateLane = {
  instanceId: string
  method: string
  queue: ScheduledTask[]
  lastStartAt: number | null
  timer: ReturnType<typeof setTimeout> | null
  draining: boolean
}

type StoredStarts = Record<string, number>

export const requestRateStorageKey = 'green-api.request-rate'

export type ScheduleRequestOptions<T> = {
  instanceId: string
  method: string
  signal: AbortSignal
  run: (signal: AbortSignal) => Promise<T>
}

let readNow = (): number => performance.now()
const lanes = new Map<string, RateLane>()

export function configureRequestRateClock(now: () => number): void {
  readNow = now
}

export function resetRequestRate(): void {
  for (const lane of lanes.values()) {
    if (lane.timer !== null) {
      clearTimeout(lane.timer)
      lane.timer = null
    }
    const pending = lane.queue
    lane.queue = []
    for (const task of pending) {
      detach(task)
      task.reject(cancelled())
    }
  }
  lanes.clear()
  readNow = () => performance.now()
  resetRequestRateIntervals()
  forgetStoredStarts()
}

export function scheduleRequest<T>({
  instanceId,
  method,
  signal,
  run,
}: ScheduleRequestOptions<T>): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(cancelled())
  }

  const lane = laneFor(instanceId, method)
  return new Promise<T>((resolve, reject) => {
    const task: ScheduledTask = {
      signal,
      run,
      resolve: (value) => {
        resolve(value as T)
      },
      reject,
      onAbort: () => undefined,
    }
    task.onAbort = () => {
      cancelQueued(lane, task)
    }
    signal.addEventListener('abort', task.onAbort)
    lane.queue.push(task)
    void drain(lane)
  })
}

function laneFor(instanceId: string, method: string): RateLane {
  const key = laneKey(instanceId, method)
  const existing = lanes.get(key)
  if (existing !== undefined) {
    return existing
  }

  const created: RateLane = {
    instanceId,
    method,
    queue: [],
    lastStartAt: restoredLastStart(instanceId, method),
    timer: null,
    draining: false,
  }
  lanes.set(key, created)
  return created
}

function cancelQueued(lane: RateLane, task: ScheduledTask): void {
  const index = lane.queue.indexOf(task)
  if (index === -1) {
    return
  }

  lane.queue.splice(index, 1)
  detach(task)
  task.reject(cancelled())
  if (lane.queue.length === 0 && lane.timer !== null) {
    clearTimeout(lane.timer)
    lane.timer = null
  }
}

async function drain(lane: RateLane): Promise<void> {
  if (lane.draining || lane.timer !== null) {
    return
  }

  lane.draining = true
  try {
    for (;;) {
      dropAborted(lane)
      const task = lane.queue[0]
      if (task === undefined) {
        return
      }

      const wait = waitBeforeStart(lane)
      if (wait > 0) {
        arm(lane, wait)
        return
      }

      const startedAt = readNow()
      const remaining = remainingWait(lane, startedAt)
      if (remaining > 0) {
        arm(lane, remaining)
        return
      }

      if (task.signal.aborted) {
        dropAborted(lane)
        continue
      }

      lane.queue.shift()
      detach(task)
      lane.lastStartAt = readNow()
      rememberStart(lane.instanceId, lane.method)
      try {
        const value = await task.run(task.signal)
        task.resolve(value)
      } catch (error) {
        task.reject(error)
      }
    }
  } finally {
    lane.draining = false
  }
}

function dropAborted(lane: RateLane): void {
  while (lane.queue[0]?.signal.aborted === true) {
    const task = lane.queue.shift()
    if (task === undefined) {
      return
    }
    detach(task)
    task.reject(cancelled())
  }
}

function waitBeforeStart(lane: RateLane): number {
  return remainingWait(lane, readNow())
}

function remainingWait(lane: RateLane, now: number): number {
  if (lane.lastStartAt === null) {
    return 0
  }

  const elapsed = now - lane.lastStartAt
  const interval = requestRateIntervalMs(lane.method)
  if (elapsed >= interval) {
    return 0
  }

  return interval - elapsed
}

function arm(lane: RateLane, wait: number): void {
  if (lane.timer !== null) {
    clearTimeout(lane.timer)
  }
  lane.timer = setTimeout(() => {
    lane.timer = null
    void drain(lane)
  }, wait)
}

function detach(task: ScheduledTask): void {
  task.signal.removeEventListener('abort', task.onAbort)
}

function restoredLastStart(instanceId: string, method: string): number | null {
  const startedAt = readStoredStart(instanceId, method)
  if (startedAt === null) {
    return null
  }

  const interval = requestRateIntervalMs(method)
  if (interval <= 0) {
    return null
  }

  const elapsed = Date.now() - startedAt
  if (!Number.isFinite(elapsed) || elapsed >= interval) {
    return null
  }

  return readNow() - Math.max(0, elapsed)
}

function rememberStart(instanceId: string, method: string): void {
  const storage = storageOrNull()
  if (storage === null) {
    return
  }

  const now = Date.now()
  if (!Number.isFinite(now)) {
    return
  }

  const starts = readStoredStarts() ?? {}
  starts[laneKey(instanceId, method)] = now
  try {
    storage.setItem(
      requestRateStorageKey,
      JSON.stringify(keptStarts(starts, now)),
    )
  } catch {
    // Очередь в памяти всё равно держит интервал до следующего запроса.
  }
}

function forgetStoredStarts(): void {
  const storage = storageOrNull()
  if (storage === null) {
    return
  }

  try {
    storage.removeItem(requestRateStorageKey)
  } catch {
    // Сбой очистки оставляет прежнюю отметку, следующий старт её перезапишет.
  }
}

function readStoredStart(instanceId: string, method: string): number | null {
  const startedAt = readStoredStarts()?.[laneKey(instanceId, method)]
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
    return null
  }

  return startedAt
}

function readStoredStarts(): StoredStarts | null {
  const storage = storageOrNull()
  if (storage === null) {
    return null
  }

  let raw: string | null
  try {
    raw = storage.getItem(requestRateStorageKey)
  } catch {
    return null
  }

  if (raw === null || raw === '') {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const starts: StoredStarts = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      starts[key] = value
    }
  }

  return starts
}

function keptStarts(starts: StoredStarts, now: number): StoredStarts {
  const kept: StoredStarts = {}
  for (const [key, startedAt] of Object.entries(starts)) {
    const interval = requestRateIntervalMs(methodFromLaneKey(key))
    const elapsed = now - startedAt
    if (!Number.isFinite(elapsed) || interval <= 0) {
      continue
    }
    if (elapsed < 0 || elapsed < interval) {
      kept[key] = startedAt
    }
  }

  return kept
}

function methodFromLaneKey(key: string): string {
  const separator = key.lastIndexOf('\u0000')
  if (separator === -1) {
    return ''
  }

  return key.slice(separator + 1)
}

function laneKey(instanceId: string, method: string): string {
  return `${instanceId}\u0000${method}`
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

function cancelled(): GreenApiError {
  return new GreenApiError('abort', 'Request was cancelled')
}
