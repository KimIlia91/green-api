import { create } from 'zustand'

import { nextOriginName } from './forward-origin.ts'
import { messagePreview, unsupportedMessageText } from './message-copy.ts'
import type {
  HistoryMessageDraft,
  Message,
  MessageDeletion,
  MessageEdit,
  MessageReaction,
  MessageReactionEvent,
  MessageState,
  OutgoingSendState,
  PendingMessageEdit,
  PendingMessageReaction,
} from './message.types.ts'

type MessagePatch = Partial<Omit<Message, 'localId' | 'sentAt'>>

type MessageStore = MessageState & {
  addMessage: (message: Message) => void
  updateMessage: (localId: string, patch: MessagePatch) => void
  mergeHistory: (
    chatId: string,
    drafts: HistoryMessageDraft[],
    createId: () => string,
  ) => void
  applyMessageEdit: (edit: MessageEdit) => void
  applyMessageReaction: (reaction: MessageReactionEvent) => void
  applyMessageDeletion: (deletion: MessageDeletion) => void
  rememberOrigin: (localId: string, name: string) => void
  removeMessage: (localId: string) => void
  reset: () => void
}

const emptyMessages = {
  messagesById: {},
  messageIdsByChatId: {},
  localIdByProviderId: {},
  historyStampByChatId: {},
  pendingEdits: {},
  pendingReactions: {},
  deletedProviderIds: {},
} satisfies MessageState

export const useMessageStore = create<MessageStore>()((set) => ({
  ...emptyMessages,
  addMessage: (message) => {
    set((state) => {
      if (state.messagesById[message.localId] !== undefined) {
        return state
      }
      if (isDeletedProvider(state, message.chatId, message.providerId)) {
        return state
      }

      const consumed = consumePending(
        message,
        state.pendingEdits,
        state.pendingReactions,
      )
      const chatIds = state.messageIdsByChatId[message.chatId] ?? []
      return {
        messagesById: {
          ...state.messagesById,
          [consumed.message.localId]: consumed.message,
        },
        messageIdsByChatId: {
          ...state.messageIdsByChatId,
          [message.chatId]: [...chatIds, consumed.message.localId],
        },
        localIdByProviderId: indexProvider(
          state.localIdByProviderId,
          consumed.message.localId,
          consumed.message.providerId,
        ),
        pendingEdits: consumed.pendingEdits,
        pendingReactions: consumed.pendingReactions,
      }
    })
  },
  updateMessage: (localId, patch) => {
    set((state) => {
      const current = state.messagesById[localId]
      if (current === undefined) {
        return state
      }

      const patched = { ...current, ...patch, localId, sentAt: current.sentAt }
      const consumed = consumePending(
        patched,
        state.pendingEdits,
        state.pendingReactions,
      )
      if (
        sameMessage(current, consumed.message) &&
        consumed.pendingEdits === state.pendingEdits &&
        consumed.pendingReactions === state.pendingReactions
      ) {
        return state
      }

      return {
        messagesById: {
          ...state.messagesById,
          [localId]: consumed.message,
        },
        messageIdsByChatId: state.messageIdsByChatId,
        localIdByProviderId: indexProvider(
          state.localIdByProviderId,
          localId,
          consumed.message.providerId,
        ),
        pendingEdits: consumed.pendingEdits,
        pendingReactions: consumed.pendingReactions,
      }
    })
  },
  mergeHistory: (chatId, drafts, createId) => {
    set((state) => mergeHistoryState(state, chatId, drafts, createId))
  },
  applyMessageEdit: (edit) => {
    set((state) => applyMessageEditState(state, edit))
  },
  applyMessageReaction: (reaction) => {
    set((state) => applyMessageReactionState(state, reaction))
  },
  applyMessageDeletion: (deletion) => {
    set((state) => applyMessageDeletionState(state, deletion))
  },
  rememberOrigin: (localId, name) => {
    set((state) => rememberOriginState(state, localId, name))
  },
  removeMessage: (localId) => {
    set((state) => removeMessageState(state, localId))
  },
  reset: () => {
    set(emptyMessages)
  },
}))

export function addMessage(message: Message): void {
  useMessageStore.getState().addMessage(message)
}

export function updateMessage(localId: string, patch: MessagePatch): void {
  useMessageStore.getState().updateMessage(localId, patch)
}

export function applyMessageEdit(edit: MessageEdit): void {
  useMessageStore.getState().applyMessageEdit(edit)
}

export function applyMessageReaction(reaction: MessageReactionEvent): void {
  useMessageStore.getState().applyMessageReaction(reaction)
}

export function applyMessageDeletion(deletion: MessageDeletion): void {
  useMessageStore.getState().applyMessageDeletion(deletion)
}

export function latestDisplayedActivity(chatId: string): {
  preview: string
  at: number
  forwarded: boolean
} | null {
  const state = useMessageStore.getState()
  const ids = state.messageIdsByChatId[chatId] ?? []
  let latest: Message | null = null
  for (const localId of ids) {
    const message = state.messagesById[localId]
    if (message === undefined) {
      continue
    }
    if (latest === null || message.createdAt >= latest.createdAt) {
      latest = message
    }
  }
  if (latest === null) {
    return null
  }

  return {
    preview: messagePreview(latest),
    at: latest.createdAt,
    forwarded: latest.forwarded === true,
  }
}

export function mergeChatHistory(
  chatId: string,
  drafts: HistoryMessageDraft[],
  createId: () => string,
): void {
  useMessageStore.getState().mergeHistory(chatId, drafts, createId)
}

export function rememberMessageOrigin(localId: string, name: string): void {
  useMessageStore.getState().rememberOrigin(localId, name)
}

export function removeMessage(localId: string): void {
  useMessageStore.getState().removeMessage(localId)
}

export function resetMessages(): void {
  useMessageStore.getState().reset()
}

const statusRank: Record<OutgoingSendState, number> = {
  sending: 0,
  unknown: 0,
  queued: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5,
}

function mergeHistoryState(
  state: MessageState,
  chatId: string,
  drafts: HistoryMessageDraft[],
  createId: () => string,
): MessageState {
  const existing = state.messageIdsByChatId[chatId] ?? []
  const position = new Map(existing.map((id, index) => [id, index]))
  const messagesById = { ...state.messagesById }
  const localIdByProviderId = { ...state.localIdByProviderId }
  let pendingEdits = state.pendingEdits
  let pendingReactions = state.pendingReactions
  const seen = new Set<string>()
  let changed = false

  for (const draft of drafts) {
    if (draft.chatId !== chatId || draft.providerId.trim() === '') {
      continue
    }
    if (seen.has(draft.providerId)) {
      continue
    }
    seen.add(draft.providerId)
    if (isDeletedProvider(state, chatId, draft.providerId)) {
      continue
    }

    const localId = localIdByProviderId[draft.providerId]
    if (localId !== undefined) {
      const current = messagesById[localId]
      if (current === undefined || current.chatId !== chatId) {
        continue
      }
      const merged = consumePending(
        mergeExisting(current, draft),
        pendingEdits,
        pendingReactions,
      )
      if (merged.pendingEdits !== pendingEdits) {
        pendingEdits = merged.pendingEdits
        changed = true
      }
      if (merged.pendingReactions !== pendingReactions) {
        pendingReactions = merged.pendingReactions
        changed = true
      }
      if (!sameMessage(current, merged.message)) {
        messagesById[localId] = merged.message
        changed = true
      }
      continue
    }

    const createdId = createId()
    const created = consumePending(
      {
        localId: createdId,
        providerId: draft.providerId,
        chatId,
        text: draft.text,
        stickerUrl: draft.stickerUrl,
        stickerMimeType: draft.stickerMimeType,
        direction: draft.direction,
        createdAt: draft.createdAt,
        sentAt: draft.sentAt,
        sendState: draft.direction === 'outgoing' ? draft.sendState : null,
        errorText: null,
        quote: draft.quote ?? null,
        ...(draft.edited === true ? { edited: true } : {}),
        ...(draft.forwarded === true ? { forwarded: true } : {}),
        ...(draft.forwardingScore != null
          ? { forwardingScore: draft.forwardingScore }
          : {}),
        originName: null,
      },
      pendingEdits,
      pendingReactions,
    )
    pendingEdits = created.pendingEdits
    pendingReactions = created.pendingReactions
    messagesById[createdId] = created.message
    localIdByProviderId[draft.providerId] = createdId
    changed = true
  }

  if (!changed) {
    return state
  }

  const ids = Object.values(messagesById)
    .filter((message) => message.chatId === chatId)
    .map((message) => message.localId)
    .sort((left, right) => {
      const leftMessage = messagesById[left]
      const rightMessage = messagesById[right]
      if (
        leftMessage === undefined ||
        rightMessage === undefined ||
        leftMessage.createdAt === rightMessage.createdAt
      ) {
        const leftPosition = position.get(left) ?? Number.MAX_SAFE_INTEGER
        const rightPosition = position.get(right) ?? Number.MAX_SAFE_INTEGER
        if (leftPosition !== rightPosition) {
          return leftPosition - rightPosition
        }
        return left < right ? -1 : 1
      }
      return leftMessage.createdAt - rightMessage.createdAt
    })

  return {
    messagesById,
    messageIdsByChatId: {
      ...state.messageIdsByChatId,
      [chatId]: ids,
    },
    localIdByProviderId,
    historyStampByChatId: {
      ...state.historyStampByChatId,
      [chatId]: (state.historyStampByChatId[chatId] ?? 0) + 1,
    },
    pendingEdits,
    pendingReactions,
    deletedProviderIds: state.deletedProviderIds,
  }
}

function mergeExisting(current: Message, draft: HistoryMessageDraft): Message {
  // История не подменяет failed, unknown и ещё идущую отправку.
  const locked =
    current.sendState === 'failed' ||
    current.sendState === 'unknown' ||
    current.sendState === 'sending'
  const sendState = locked
    ? current.sendState
    : upgradeSendState(current.sendState, draft.sendState)

  return {
    ...current,
    text:
      draft.stickerUrl !== null
        ? draft.text
        : current.stickerUrl !== null && draft.text === unsupportedMessageText
          ? current.text
          : nextText(current.text, draft.text),
    stickerUrl: draft.stickerUrl ?? current.stickerUrl,
    stickerMimeType:
      draft.stickerUrl === null
        ? current.stickerMimeType
        : draft.stickerMimeType,
    createdAt: draft.edited === true ? current.createdAt : draft.createdAt,
    sentAt: current.sentAt,
    sendState,
    errorText: sendState === current.sendState ? current.errorText : null,
    quote: mergeQuote(current.quote ?? null, draft.quote ?? null),
    edited:
      current.edited === true || draft.edited === true ? true : current.edited,
    forwarded:
      current.forwarded === true || draft.forwarded === true
        ? true
        : current.forwarded,
    forwardingScore: draft.forwardingScore ?? current.forwardingScore,
    originName: nextOriginName({
      current: current.originName,
      forwarded: current.forwarded === true || draft.forwarded === true,
      knownAuthor: null,
    }),
  }
}

function upgradeSendState(
  current: OutgoingSendState | null,
  incoming: OutgoingSendState | null,
): OutgoingSendState | null {
  if (incoming === null) {
    return current
  }
  if (current === null) {
    return incoming
  }
  return statusRank[incoming] >= statusRank[current] ? incoming : current
}

function mergeQuote(
  current: Message['quote'],
  incoming: Message['quote'],
): Message['quote'] {
  const kept = current ?? null
  const next = incoming ?? null
  if (next === null) {
    return kept
  }
  if (kept === null || kept.sourceId !== next.sourceId) {
    return next
  }

  return {
    sourceId: kept.sourceId,
    excerpt: next.excerpt ?? kept.excerpt,
    authorName: next.authorName ?? kept.authorName,
    typeMessage: next.typeMessage ?? kept.typeMessage,
  }
}

function nextText(current: string, incoming: string): string {
  if (
    incoming === unsupportedMessageText &&
    current !== '' &&
    current !== unsupportedMessageText
  ) {
    return current
  }
  return incoming
}

function sameMessage(current: Message, next: Message): boolean {
  return (
    current.providerId === next.providerId &&
    current.chatId === next.chatId &&
    current.text === next.text &&
    current.stickerUrl === next.stickerUrl &&
    current.stickerMimeType === next.stickerMimeType &&
    current.direction === next.direction &&
    current.createdAt === next.createdAt &&
    current.sentAt === next.sentAt &&
    current.sendState === next.sendState &&
    current.errorText === next.errorText &&
    (current.edited === true) === (next.edited === true) &&
    (current.editEventAt ?? null) === (next.editEventAt ?? null) &&
    (current.forwarded === true) === (next.forwarded === true) &&
    (current.forwardingScore ?? null) === (next.forwardingScore ?? null) &&
    (current.originName ?? null) === (next.originName ?? null) &&
    sameQuote(current.quote ?? null, next.quote ?? null) &&
    sameReactions(current.reactions, next.reactions)
  )
}

function sameReactions(
  current: Message['reactions'],
  next: Message['reactions'],
): boolean {
  const left = current ?? []
  const right = next ?? []
  if (left.length !== right.length) {
    return false
  }
  return left.every(
    (reaction, index) =>
      reaction.sourceId === right[index]?.sourceId &&
      reaction.emoji === right[index]?.emoji &&
      reaction.eventAt === right[index]?.eventAt,
  )
}

function sameQuote(current: Message['quote'], next: Message['quote']): boolean {
  const left = current ?? null
  const right = next ?? null
  if (left === right) {
    return true
  }
  if (left === null || right === null) {
    return false
  }

  return (
    left.sourceId === right.sourceId &&
    left.excerpt === right.excerpt &&
    left.authorName === right.authorName &&
    left.typeMessage === right.typeMessage
  )
}

function applyMessageEditState(
  state: MessageState,
  edit: MessageEdit,
): MessageState {
  const chatId = edit.chatId.trim()
  if (chatId === '') {
    return state
  }

  const originalId = edit.originalId?.trim() ?? ''
  const eventId = edit.eventId.trim()
  let next = state
  if (eventId !== '' && eventId !== originalId) {
    next = dropProviderMessage(next, chatId, eventId)
  }

  if (originalId === '' || edit.text === null) {
    return next
  }

  const localId = next.localIdByProviderId[originalId]
  const current = localId === undefined ? undefined : next.messagesById[localId]
  if (current !== undefined && current.chatId === chatId) {
    if (isOlderEdit(edit.eventAt, current.editEventAt)) {
      return next
    }
    const updated = {
      ...current,
      text: edit.text,
      edited: true as const,
      editEventAt: edit.eventAt ?? current.editEventAt,
    }
    const pendingEdits = omitPending(next.pendingEdits, chatId, originalId)
    if (sameMessage(current, updated) && pendingEdits === next.pendingEdits) {
      return next
    }

    return {
      ...next,
      messagesById: {
        ...next.messagesById,
        [current.localId]: updated,
      },
      pendingEdits,
    }
  }

  const key = pendingKey(chatId, originalId)
  const currentPending = next.pendingEdits[key]
  if (
    currentPending?.text === edit.text &&
    currentPending.eventAt === edit.eventAt
  ) {
    return next
  }
  if (isOlderEdit(edit.eventAt, currentPending?.eventAt)) {
    return next
  }

  return {
    ...next,
    pendingEdits: {
      ...next.pendingEdits,
      [key]: {
        chatId,
        originalId,
        text: edit.text,
        eventAt: edit.eventAt,
      },
    },
  }
}

function rememberOriginState(
  state: MessageState,
  localId: string,
  name: string,
): MessageState {
  const current = state.messagesById[localId]
  if (current === undefined || current.forwarded === true) {
    return state
  }

  const originName = nextOriginName({
    current: current.originName,
    forwarded: false,
    knownAuthor: name,
  })
  if (originName === null || originName === current.originName) {
    return state
  }

  return {
    ...state,
    messagesById: {
      ...state.messagesById,
      [localId]: { ...current, originName },
    },
  }
}

function removeMessageState(
  state: MessageState,
  localId: string,
): MessageState {
  const message = state.messagesById[localId]
  if (message === undefined) {
    return state
  }

  const messagesById = { ...state.messagesById }
  delete messagesById[localId]
  const localIdByProviderId = { ...state.localIdByProviderId }
  if (
    message.providerId !== null &&
    localIdByProviderId[message.providerId] === localId
  ) {
    delete localIdByProviderId[message.providerId]
  }
  const ids = state.messageIdsByChatId[message.chatId] ?? []

  return {
    ...state,
    messagesById,
    localIdByProviderId,
    messageIdsByChatId: {
      ...state.messageIdsByChatId,
      [message.chatId]: ids.filter((id) => id !== localId),
    },
    historyStampByChatId: {
      ...state.historyStampByChatId,
      [message.chatId]: (state.historyStampByChatId[message.chatId] ?? 0) + 1,
    },
  }
}

function dropProviderMessage(
  state: MessageState,
  chatId: string,
  providerId: string,
): MessageState {
  const localId = state.localIdByProviderId[providerId]
  if (localId === undefined) {
    return state
  }

  const message = state.messagesById[localId]
  if (
    message === undefined ||
    message.chatId !== chatId ||
    message.providerId !== providerId
  ) {
    return state
  }

  const messagesById = { ...state.messagesById }
  delete messagesById[localId]
  const localIdByProviderId = { ...state.localIdByProviderId }
  delete localIdByProviderId[providerId]

  return {
    ...state,
    messagesById,
    localIdByProviderId,
    messageIdsByChatId: {
      ...state.messageIdsByChatId,
      [chatId]: (state.messageIdsByChatId[chatId] ?? []).filter(
        (id) => id !== localId,
      ),
    },
    historyStampByChatId: {
      ...state.historyStampByChatId,
      [chatId]: (state.historyStampByChatId[chatId] ?? 0) + 1,
    },
  }
}

function consumePending(
  message: Message,
  pendingEdits: Record<string, PendingMessageEdit>,
  pendingReactions: Record<string, PendingMessageReaction> = {},
): {
  message: Message
  pendingEdits: Record<string, PendingMessageEdit>
  pendingReactions: Record<string, PendingMessageReaction>
} {
  const withEdit = consumePendingEdit(message, pendingEdits)
  return consumePendingReactions(
    withEdit.message,
    withEdit.pendingEdits,
    pendingReactions,
  )
}

function consumePendingEdit(
  message: Message,
  pendingEdits: Record<string, PendingMessageEdit>,
): { message: Message; pendingEdits: Record<string, PendingMessageEdit> } {
  if (message.providerId === null || message.providerId.trim() === '') {
    return { message, pendingEdits }
  }

  const key = pendingKey(message.chatId, message.providerId)
  const pending = pendingEdits[key]
  if (pending === undefined) {
    return { message, pendingEdits }
  }

  const pendingEditsNext = omitPending(
    pendingEdits,
    message.chatId,
    message.providerId,
  )
  if (isOlderEdit(pending.eventAt, message.editEventAt)) {
    return { message, pendingEdits: pendingEditsNext }
  }

  return {
    message: {
      ...message,
      text: pending.text,
      edited: true,
      editEventAt: pending.eventAt ?? message.editEventAt,
    },
    pendingEdits: pendingEditsNext,
  }
}

function consumePendingReactions(
  message: Message,
  pendingEdits: Record<string, PendingMessageEdit>,
  pendingReactions: Record<string, PendingMessageReaction>,
): {
  message: Message
  pendingEdits: Record<string, PendingMessageEdit>
  pendingReactions: Record<string, PendingMessageReaction>
} {
  if (message.providerId === null || message.providerId.trim() === '') {
    return { message, pendingEdits, pendingReactions }
  }

  const prefix = `${pendingKey(message.chatId, message.providerId)}\0`
  let reactions = message.reactions
  let nextPending = pendingReactions
  let changed = false
  for (const [key, pending] of Object.entries(pendingReactions)) {
    if (!key.startsWith(prefix) || pending.targetId !== message.providerId) {
      continue
    }
    if (nextPending === pendingReactions) {
      nextPending = { ...pendingReactions }
    }
    delete nextPending[key]
    changed = true
    reactions = upsertReaction(reactions, pending)
  }

  if (!changed) {
    return { message, pendingEdits, pendingReactions }
  }

  return {
    message: { ...message, reactions },
    pendingEdits,
    pendingReactions: nextPending,
  }
}

function isOlderEdit(
  eventAt: number | null | undefined,
  currentAt: number | null | undefined,
): boolean {
  return (
    eventAt !== null &&
    eventAt !== undefined &&
    currentAt !== null &&
    currentAt !== undefined &&
    eventAt < currentAt
  )
}

function omitPending(
  pendingEdits: Record<string, PendingMessageEdit>,
  chatId: string,
  originalId: string,
): Record<string, PendingMessageEdit> {
  const key = pendingKey(chatId, originalId)
  if (!(key in pendingEdits)) {
    return pendingEdits
  }

  const next = { ...pendingEdits }
  delete next[key]
  return next
}

function pendingKey(chatId: string, originalId: string): string {
  return `${chatId}\0${originalId}`
}

function applyMessageReactionState(
  state: MessageState,
  reaction: MessageReactionEvent,
): MessageState {
  const chatId = reaction.chatId.trim()
  const sourceId = reaction.sourceId.trim()
  if (chatId === '' || sourceId === '') {
    return state
  }

  const next = dropProviderMessage(state, chatId, sourceId)
  const targetId = reaction.targetId?.trim() ?? ''
  if (targetId === '') {
    return next
  }

  const emoji = reaction.emoji?.trim() ?? ''
  const localId = next.localIdByProviderId[targetId]
  const current = localId === undefined ? undefined : next.messagesById[localId]
  if (current !== undefined && current.chatId === chatId) {
    const reactions =
      emoji === ''
        ? (current.reactions ?? []).filter((item) => item.sourceId !== sourceId)
        : upsertReaction(current.reactions, {
            sourceId,
            emoji,
            eventAt: reaction.eventAt,
            chatId,
            targetId,
          })
    if (sameReactions(current.reactions, reactions)) {
      return next
    }
    return {
      ...next,
      messagesById: {
        ...next.messagesById,
        [current.localId]: { ...current, reactions },
      },
    }
  }

  if (emoji === '') {
    return next
  }

  const key = reactionKey(chatId, targetId, sourceId)
  const currentPending = next.pendingReactions[key]
  if (
    currentPending?.emoji === emoji &&
    currentPending.eventAt === reaction.eventAt
  ) {
    return next
  }
  if (isOlderEdit(reaction.eventAt, currentPending?.eventAt)) {
    return next
  }

  return {
    ...next,
    pendingReactions: {
      ...next.pendingReactions,
      [key]: {
        chatId,
        targetId,
        sourceId,
        emoji,
        eventAt: reaction.eventAt,
      },
    },
  }
}

function applyMessageDeletionState(
  state: MessageState,
  deletion: MessageDeletion,
): MessageState {
  const chatId = deletion.chatId.trim()
  if (chatId === '') {
    return state
  }

  const eventId = deletion.eventId.trim()
  const targetId = deletion.targetId?.trim() ?? ''
  let next = state
  if (eventId !== '' && eventId !== targetId) {
    next = dropProviderMessage(next, chatId, eventId)
  }
  if (targetId === '') {
    return next
  }

  const key = pendingKey(chatId, targetId)
  const deletedProviderIds = next.deletedProviderIds[key]
    ? next.deletedProviderIds
    : { ...next.deletedProviderIds, [key]: true as const }
  return dropProviderMessage({ ...next, deletedProviderIds }, chatId, targetId)
}

function upsertReaction(
  current: Message['reactions'],
  pending: PendingMessageReaction,
): MessageReaction[] {
  const reactions = current ?? []
  const previous = reactions.find((item) => item.sourceId === pending.sourceId)
  if (
    previous !== undefined &&
    isOlderEdit(pending.eventAt, previous.eventAt)
  ) {
    return reactions
  }
  const next = reactions.filter((item) => item.sourceId !== pending.sourceId)
  next.push({
    sourceId: pending.sourceId,
    emoji: pending.emoji,
    eventAt: pending.eventAt,
  })
  next.sort((left, right) => (left.sourceId < right.sourceId ? -1 : 1))
  return next
}

function isDeletedProvider(
  state: MessageState,
  chatId: string,
  providerId: string | null,
): boolean {
  if (providerId === null || providerId.trim() === '') {
    return false
  }
  return state.deletedProviderIds[pendingKey(chatId, providerId)] === true
}

function reactionKey(
  chatId: string,
  targetId: string,
  sourceId: string,
): string {
  return `${pendingKey(chatId, targetId)}\0${sourceId}`
}

function indexProvider(
  index: Record<string, string>,
  localId: string,
  providerId: string | null,
): Record<string, string> {
  if (providerId === null || providerId.trim() === '') {
    return index
  }

  if (index[providerId] === localId) {
    return index
  }

  return {
    ...index,
    [providerId]: localId,
  }
}
