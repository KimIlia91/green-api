import { messagePreview } from './message-copy.ts'
import { applyMessageEdit, useMessageStore } from './message.store.ts'
import type { Message, MessageEdit } from './message.types.ts'

export type EditedChatPatch =
  | {
      mode: 'restore'
      preview: string | null
      at: number | null
      forwarded: boolean
    }
  | { mode: 'refresh'; preview: string; at: number }

export type EditChatPorts = {
  dismissUnseenIncoming: (chatId: string, providerId: string) => void
  correctActivityFromEdit: (
    chatId: string,
    eventAt: number,
    next: { preview: string; at: number; forwarded: boolean } | null,
  ) => void
  refreshPreviewText: (chatId: string, preview: string, at: number) => void
  rewindDisplayedPreview?: (
    chatId: string,
    activity: { preview: string; at: number; forwarded: boolean } | null,
  ) => void
}

export function editedChatPatch(
  chatId: string,
  eventAt: number | null,
  lastActivityAt: number | null,
): EditedChatPatch | null {
  const latest = latestMessage(chatId)
  if (eventAt !== null && lastActivityAt === eventAt) {
    if (latest === null) {
      return { mode: 'restore', preview: null, at: null, forwarded: false }
    }
    if (latest.createdAt !== eventAt) {
      return {
        mode: 'restore',
        preview: messagePreview(latest),
        at: latest.createdAt,
        forwarded: latest.forwarded === true,
      }
    }
    return {
      mode: 'refresh',
      preview: messagePreview(latest),
      at: latest.createdAt,
    }
  }

  if (
    latest !== null &&
    lastActivityAt !== null &&
    latest.createdAt === lastActivityAt
  ) {
    return {
      mode: 'refresh',
      preview: messagePreview(latest),
      at: latest.createdAt,
    }
  }

  return null
}

export function quietJournalEvent(
  chatId: string,
  eventAt: number | null,
  eventId: string,
  lastActivityAt: number | null,
  chat: EditChatPorts,
): void {
  const id = eventId.trim()
  if (id !== '') {
    chat.dismissUnseenIncoming(chatId, id)
  }
  applyJournalPreview(chatId, eventAt, lastActivityAt, chat)
}

export function publishMessageEdit(
  edit: MessageEdit,
  lastActivityAt: number | null,
  chat: EditChatPorts,
): void {
  applyMessageEdit(edit)
  const originalId = edit.originalId?.trim() ?? ''
  const eventId = edit.eventId.trim()
  if (eventId !== '' && eventId !== originalId) {
    chat.dismissUnseenIncoming(edit.chatId, eventId)
  }

  applyJournalPreview(edit.chatId, edit.eventAt, lastActivityAt, chat)
}

function applyJournalPreview(
  chatId: string,
  eventAt: number | null,
  lastActivityAt: number | null,
  chat: EditChatPorts,
): void {
  const patch = editedChatPatch(chatId, eventAt, lastActivityAt)
  if (patch === null) {
    return
  }
  if (patch.mode === 'restore') {
    if (eventAt === null) {
      return
    }
    chat.correctActivityFromEdit(
      chatId,
      eventAt,
      patch.preview === null || patch.at === null
        ? null
        : {
            preview: patch.preview,
            at: patch.at,
            forwarded: patch.forwarded,
          },
    )
    return
  }

  chat.refreshPreviewText(chatId, patch.preview, patch.at)
}

function latestMessage(chatId: string): Message | null {
  const state = useMessageStore.getState()
  const ids = state.messageIdsByChatId[chatId] ?? []
  let latest: Message | null = null
  let latestIndex = -1
  ids.forEach((localId, index) => {
    const message = state.messagesById[localId]
    if (message === undefined) {
      return
    }
    if (
      latest === null ||
      message.createdAt > latest.createdAt ||
      (message.createdAt === latest.createdAt && index > latestIndex)
    ) {
      latest = message
      latestIndex = index
    }
  })

  return latest
}
