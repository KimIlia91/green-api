import { create } from 'zustand'

import { useMessageStore } from '@/entities/message'
import { sessionIdentity, useSessionStore } from '@/entities/session'
import {
  classifyTariffLimit,
  createGreenApiClient,
  GreenApiError,
} from '@/shared/api'
import type { ReadChatParams, TariffLimitKind } from '@/shared/api'
import { showToast } from '@/shared/lib/toast'

export const readReceiptErrorMessage =
  'Не удалось отметить сообщения прочитанными.'

const readMethodQuotaMessage = 'Превышена месячная квота отметки прочтения.'
const readChatQuotaMessage = 'Превышена квота чатов тарифа.'
const readBothQuotaMessage = 'Превышена квота чатов и отметки прочтения.'
const readTariffLimitMessage = 'Сработало ограничение тарифа.'

type IncomingReadState = {
  notice: string
  noticeChatId: string
  setNotice: (chatId: string, notice: string) => void
  clearNotice: (chatId?: string) => void
}

export const useIncomingReadStore = create<IncomingReadState>()((set) => ({
  notice: '',
  noticeChatId: '',
  setNotice: (chatId, notice) => {
    set((state) =>
      state.notice === notice && state.noticeChatId === chatId
        ? state
        : { notice, noticeChatId: chatId },
    )
  },
  clearNotice: (chatId) => {
    set((state) => {
      if (chatId !== undefined && state.noticeChatId !== chatId) {
        return state
      }
      if (state.notice === '' && state.noticeChatId === '') {
        return state
      }
      return { notice: '', noticeChatId: '' }
    })
  },
}))

export function incomingReadNotice(chatId: string): string {
  const state = useIncomingReadStore.getState()
  return state.noticeChatId === chatId ? state.notice : ''
}

export type IncomingReadTarget = {
  chatId: string
  idMessage: string
}

type ReadClient = {
  readChat: (
    params: ReadChatParams,
    options?: { signal?: AbortSignal },
  ) => Promise<{ setRead: boolean }>
}

type ScheduleOptions = {
  client?: ReadClient
}

type Flight = {
  target: IncomingReadTarget
  abort: AbortController
  generation: number
  sessionKey: string
}

let generation = 0
let inflight: Flight | null = null
let clientOverride: ReadClient | undefined
let quotaHold = false
const pending = new Map<string, string>()
const confirmed = new Set<string>()
const held = new Set<string>()

export function cancelIncomingReads(): void {
  generation += 1
  inflight?.abort.abort()
  inflight = null
  pending.clear()
  confirmed.clear()
  held.clear()
  quotaHold = false
  clientOverride = undefined
  useIncomingReadStore.getState().clearNotice()
}

export function armIncomingRead(chatId: string): void {
  if (quotaHold) {
    return
  }

  const prefix = `${chatId}\0`
  for (const item of [...held]) {
    if (item.startsWith(prefix)) {
      held.delete(item)
    }
  }
}

export function scheduleIncomingRead(
  target: IncomingReadTarget,
  options: ScheduleOptions = {},
): void {
  if (quotaHold) {
    return
  }

  const next = normalize(target)
  if (next === null || isCovered(next) || held.has(key(next))) {
    return
  }

  if (options.client !== undefined) {
    clientOverride = options.client
  }

  const current = inflight
  if (current !== null) {
    if (!covers(current.target, next)) {
      remember(next)
    }
    return
  }

  start(next)
}

function start(target: IncomingReadTarget): void {
  const connection = useSessionStore.getState().connection
  if (connection === null) {
    return
  }

  const flight: Flight = {
    target,
    abort: new AbortController(),
    generation,
    sessionKey: sessionIdentity(connection),
  }
  inflight = flight
  void execute(flight)
}

async function execute(flight: Flight): Promise<void> {
  try {
    const connection = useSessionStore.getState().connection
    if (
      connection === null ||
      !isCurrent(flight.generation, flight.sessionKey, flight.abort.signal)
    ) {
      return
    }

    const api = clientOverride ?? createGreenApiClient(connection)
    const result = await api.readChat(
      {
        chatId: flight.target.chatId,
        idMessage: flight.target.idMessage,
      },
      { signal: flight.abort.signal },
    )
    if (!isCurrent(flight.generation, flight.sessionKey, flight.abort.signal)) {
      return
    }
    if (result.setRead !== true) {
      hold(flight.target)
      return
    }

    markConfirmed(flight.target)
    useIncomingReadStore.getState().clearNotice(flight.target.chatId)
  } catch (error) {
    if (!isCurrent(flight.generation, flight.sessionKey, flight.abort.signal)) {
      return
    }
    if (error instanceof GreenApiError && error.kind === 'abort') {
      return
    }
    hold(flight.target, error)
  } finally {
    if (inflight === flight) {
      inflight = null
    }
    if (generation === flight.generation) {
      const next = takeNext()
      if (next !== null) {
        start(next)
      }
    }
  }
}

function hold(target: IncomingReadTarget, error?: unknown): void {
  held.add(key(target))
  if (
    error instanceof GreenApiError &&
    error.kind === 'http' &&
    error.status === 466
  ) {
    quotaHold = true
    pending.clear()
    showToast({
      kind: 'error',
      message: readTariffNotice(classifyTariffLimit(error.responseBody)),
      dedupeKey: 'read-chat:466',
    })
    return
  }
  useIncomingReadStore
    .getState()
    .setNotice(target.chatId, readReceiptErrorMessage)
}

function readTariffNotice(kind: TariffLimitKind): string {
  if (kind === 'chats') {
    return readChatQuotaMessage
  }
  if (kind === 'method') {
    return readMethodQuotaMessage
  }
  if (kind === 'both') {
    return readBothQuotaMessage
  }
  return readTariffLimitMessage
}

function remember(target: IncomingReadTarget): void {
  const current = pending.get(target.chatId)
  pending.set(
    target.chatId,
    current === undefined
      ? target.idMessage
      : laterId(target.chatId, current, target.idMessage),
  )
}

function takeNext(): IncomingReadTarget | null {
  for (const [chatId, idMessage] of pending) {
    pending.delete(chatId)
    const target = { chatId, idMessage }
    if (quotaHold || held.has(key(target)) || isCovered(target)) {
      continue
    }
    return target
  }
  return null
}

function normalize(target: IncomingReadTarget): IncomingReadTarget | null {
  const chatId = target.chatId.trim()
  const idMessage = target.idMessage.trim()
  if (chatId === '' || idMessage === '') {
    return null
  }
  return { chatId, idMessage }
}

function covers(
  current: IncomingReadTarget,
  next: IncomingReadTarget,
): boolean {
  if (current.chatId !== next.chatId) {
    return false
  }
  if (current.idMessage === next.idMessage) {
    return true
  }

  const currentRank = rankOf(current.chatId, current.idMessage)
  const nextRank = rankOf(next.chatId, next.idMessage)
  return currentRank >= 0 && nextRank >= 0 && currentRank >= nextRank
}

function laterId(chatId: string, current: string, next: string): string {
  const currentRank = rankOf(chatId, current)
  const nextRank = rankOf(chatId, next)
  if (nextRank < 0) {
    return currentRank < 0 ? next : current
  }
  if (currentRank < 0) {
    return next
  }
  return nextRank >= currentRank ? next : current
}

function isCovered(target: IncomingReadTarget): boolean {
  if (confirmed.has(key(target))) {
    return true
  }

  const rank = rankOf(target.chatId, target.idMessage)
  if (rank < 0) {
    return false
  }

  for (const item of confirmed) {
    const splitAt = item.indexOf('\0')
    if (splitAt < 0) {
      continue
    }
    const chatId = item.slice(0, splitAt)
    if (chatId !== target.chatId) {
      continue
    }
    const confirmedRank = rankOf(chatId, item.slice(splitAt + 1))
    if (confirmedRank >= rank) {
      return true
    }
  }
  return false
}

function markConfirmed(target: IncomingReadTarget): void {
  const ids = useMessageStore.getState().messageIdsByChatId[target.chatId] ?? []
  const messages = useMessageStore.getState().messagesById
  let end = -1
  for (const [index, localId] of ids.entries()) {
    const message = messages[localId]
    if (message?.providerId?.trim() === target.idMessage) {
      end = index
    }
  }

  if (end < 0) {
    confirmed.add(key(target))
    return
  }

  for (const localId of ids.slice(0, end + 1)) {
    const message = messages[localId]
    if (message === undefined || message.direction !== 'incoming') {
      continue
    }
    const providerId = message.providerId?.trim() ?? ''
    if (providerId === '') {
      continue
    }
    confirmed.add(key({ chatId: target.chatId, idMessage: providerId }))
  }
}

function rankOf(chatId: string, idMessage: string): number {
  const ids = useMessageStore.getState().messageIdsByChatId[chatId] ?? []
  const messages = useMessageStore.getState().messagesById
  let rank = -1
  for (const [index, localId] of ids.entries()) {
    if (messages[localId]?.providerId?.trim() === idMessage) {
      rank = index
    }
  }
  return rank
}

function key(target: IncomingReadTarget): string {
  return `${target.chatId}\0${target.idMessage}`
}

function isCurrent(
  generationAtStart: number,
  sessionKey: string,
  signal: AbortSignal,
): boolean {
  return (
    generation === generationAtStart &&
    !signal.aborted &&
    sessionIdentity(useSessionStore.getState().connection) === sessionKey
  )
}

export function confirmedIncomingRead(target: IncomingReadTarget): boolean {
  const next = normalize(target)
  return next !== null && isCovered(next)
}
