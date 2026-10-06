import { create } from 'zustand'

import type {
  Chat,
  ChatActivity,
  ChatDraft,
  ChatState,
  RemoteChatInput,
} from './chat.types.ts'

type ChatStore = ChatState & {
  upsertChat: (chat: ChatDraft) => void
  mergeRemoteChats: (chats: RemoteChatInput[]) => void
  recordChatActivity: (chatId: string, activity: ChatActivity) => void
  refreshPreviewText: (chatId: string, preview: string, at: number) => void
  correctActivityFromEdit: (
    chatId: string,
    eventAt: number,
    next: ChatActivity | null,
  ) => void
  rewindDisplayedPreview: (
    chatId: string,
    activity: ChatActivity | null,
  ) => void
  dismissUnseenIncoming: (chatId: string, providerId: string) => void
  noteUnseenIncoming: (chatId: string, providerId: string) => void
  markIncomingViewed: (chatId: string, providerIds: readonly string[]) => void
  selectChat: (chatId: string) => void
  clearActiveChat: () => void
  reset: () => void
}

const emptyChats = {
  chatsById: {},
  chatIds: [],
  activeChatId: null,
  viewedIncomingIds: [],
} satisfies ChatState

export const useChatStore = create<ChatStore>()((set) => ({
  ...emptyChats,
  upsertChat: (chat) => {
    set((state) => {
      const current = state.chatsById[chat.chatId]
      const next = normalizeChat(chat, current)
      if (current !== undefined && sameChat(current, next)) {
        return state
      }

      return {
        chatsById: {
          ...state.chatsById,
          [chat.chatId]: next,
        },
        chatIds:
          current === undefined
            ? [...state.chatIds, chat.chatId]
            : state.chatIds,
        activeChatId: state.activeChatId,
      }
    })
  },
  mergeRemoteChats: (chats) => {
    set((state) => {
      let chatsById = state.chatsById
      let chatIds = state.chatIds
      let changed = false

      for (const remote of chats) {
        const chatId = remote.chatId.trim()
        if (chatId === '') {
          continue
        }

        const current = chatsById[chatId]
        const name = filled(remote.name)
        const phoneNumber = filled(remote.phoneNumber)
        if (current === undefined) {
          chatsById = {
            ...chatsById,
            [chatId]: {
              chatId,
              name,
              phoneNumber,
              username: null,
              preview: null,
              previewForwarded: false,
              lastActivityAt: null,
              unseenIncomingIds: [],
            },
          }
          chatIds = [...chatIds, chatId]
          changed = true
          continue
        }

        const nextName = name ?? current.name
        const nextPhone = phoneNumber ?? current.phoneNumber
        if (nextName === current.name && nextPhone === current.phoneNumber) {
          continue
        }

        chatsById = {
          ...chatsById,
          [chatId]: {
            ...current,
            name: nextName,
            phoneNumber: nextPhone,
          },
        }
        changed = true
      }

      if (!changed) {
        return state
      }

      return {
        chatsById,
        chatIds,
        activeChatId: state.activeChatId,
        viewedIncomingIds: state.viewedIncomingIds,
      }
    })
  },
  recordChatActivity: (chatId, activity) => {
    set((state) => {
      const current = state.chatsById[chatId]
      if (current === undefined) {
        return state
      }

      const newer =
        current.lastActivityAt === null || activity.at > current.lastActivityAt
      const same = current.lastActivityAt === activity.at
      const preview = newer ? activity.preview : current.preview
      const lastActivityAt = newer ? activity.at : current.lastActivityAt
      const previewForwarded = newer
        ? activity.forwarded === true
        : same && typeof activity.forwarded === 'boolean'
          ? activity.forwarded
          : current.previewForwarded
      if (
        preview === current.preview &&
        lastActivityAt === current.lastActivityAt &&
        previewForwarded === current.previewForwarded
      ) {
        return state
      }

      return {
        ...state,
        chatsById: {
          ...state.chatsById,
          [chatId]: {
            ...current,
            preview,
            lastActivityAt,
            previewForwarded,
          },
        },
      }
    })
  },
  refreshPreviewText: (chatId, preview, at) => {
    set((state) => {
      const current = state.chatsById[chatId]
      if (
        current === undefined ||
        current.lastActivityAt !== at ||
        current.preview === preview
      ) {
        return state
      }

      return {
        ...state,
        chatsById: {
          ...state.chatsById,
          [chatId]: {
            ...current,
            preview,
          },
        },
      }
    })
  },
  rewindDisplayedPreview: (chatId, activity) => {
    rewindDisplayedPreview(chatId, activity)
  },
  correctActivityFromEdit: (chatId, eventAt, next) => {
    set((state) => {
      const current = state.chatsById[chatId]
      if (current === undefined || current.lastActivityAt !== eventAt) {
        return state
      }

      const preview = next === null ? null : next.preview
      const lastActivityAt = next === null ? null : next.at
      const previewForwarded = next?.forwarded === true
      if (
        preview === current.preview &&
        lastActivityAt === current.lastActivityAt &&
        previewForwarded === current.previewForwarded
      ) {
        return state
      }

      return {
        ...state,
        chatsById: {
          ...state.chatsById,
          [chatId]: {
            ...current,
            preview,
            lastActivityAt,
            previewForwarded,
          },
        },
      }
    })
  },
  dismissUnseenIncoming: (chatId, providerId) => {
    const id = providerId.trim()
    if (id === '') {
      return
    }

    set((state) => {
      const current = state.chatsById[chatId]
      if (current === undefined || !current.unseenIncomingIds.includes(id)) {
        return state
      }

      return {
        ...state,
        chatsById: {
          ...state.chatsById,
          [chatId]: {
            ...current,
            unseenIncomingIds: current.unseenIncomingIds.filter(
              (item) => item !== id,
            ),
          },
        },
      }
    })
  },
  noteUnseenIncoming: (chatId, providerId) => {
    const id = providerId.trim()
    if (id === '') {
      return
    }

    set((state) => {
      const current = state.chatsById[chatId]
      if (
        current === undefined ||
        state.viewedIncomingIds.includes(id) ||
        current.unseenIncomingIds.includes(id)
      ) {
        return state
      }

      return {
        ...state,
        chatsById: {
          ...state.chatsById,
          [chatId]: {
            ...current,
            unseenIncomingIds: [...current.unseenIncomingIds, id],
          },
        },
      }
    })
  },
  markIncomingViewed: (chatId, providerIds) => {
    const ids = providerIds.filter((id) => id.trim() !== '')
    if (ids.length === 0) {
      return
    }

    set((state) => {
      const current = state.chatsById[chatId]
      if (current === undefined) {
        return state
      }

      const viewed = new Set(state.viewedIncomingIds)
      let viewedChanged = false
      for (const id of ids) {
        if (!viewed.has(id)) {
          viewed.add(id)
          viewedChanged = true
        }
      }

      const unseenIncomingIds = current.unseenIncomingIds.filter(
        (id) => !viewed.has(id),
      )
      if (
        !viewedChanged &&
        unseenIncomingIds.length === current.unseenIncomingIds.length
      ) {
        return state
      }

      return {
        ...state,
        viewedIncomingIds: viewedChanged
          ? [...viewed]
          : state.viewedIncomingIds,
        chatsById: {
          ...state.chatsById,
          [chatId]: {
            ...current,
            unseenIncomingIds,
          },
        },
      }
    })
  },
  selectChat: (chatId) => {
    set((state) => {
      if (
        state.chatsById[chatId] === undefined ||
        state.activeChatId === chatId
      ) {
        return state
      }

      return {
        ...state,
        activeChatId: chatId,
      }
    })
  },
  clearActiveChat: () => {
    set((state) => {
      if (state.activeChatId === null) {
        return state
      }

      return {
        ...state,
        activeChatId: null,
      }
    })
  },
  reset: () => {
    set(emptyChats)
  },
}))

export function upsertChat(chat: ChatDraft): void {
  useChatStore.getState().upsertChat(chat)
}

export function mergeRemoteChats(chats: RemoteChatInput[]): void {
  useChatStore.getState().mergeRemoteChats(chats)
}

export function recordChatActivity(
  chatId: string,
  activity: ChatActivity,
): void {
  useChatStore.getState().recordChatActivity(chatId, activity)
}

export function refreshPreviewText(
  chatId: string,
  preview: string,
  at: number,
): void {
  useChatStore.getState().refreshPreviewText(chatId, preview, at)
}

export function rewindDisplayedPreview(
  chatId: string,
  activity: ChatActivity | null,
): void {
  const chat = useChatStore.getState().chatsById[chatId]
  if (chat === undefined || chat.lastActivityAt === null) {
    return
  }
  if (activity === null) {
    useChatStore
      .getState()
      .correctActivityFromEdit(chatId, chat.lastActivityAt, null)
    return
  }
  if (activity.at > chat.lastActivityAt) {
    useChatStore.getState().recordChatActivity(chatId, {
      preview: activity.preview,
      at: activity.at,
      forwarded: activity.forwarded,
    })
    return
  }
  if (chat.lastActivityAt > activity.at) {
    useChatStore
      .getState()
      .correctActivityFromEdit(chatId, chat.lastActivityAt, activity)
    return
  }
  useChatStore
    .getState()
    .refreshPreviewText(chatId, activity.preview, activity.at)
  useChatStore.getState().recordChatActivity(chatId, {
    preview: activity.preview,
    at: activity.at,
    forwarded: activity.forwarded,
  })
}

export function correctActivityFromEdit(
  chatId: string,
  eventAt: number,
  next: ChatActivity | null,
): void {
  useChatStore.getState().correctActivityFromEdit(chatId, eventAt, next)
}

export function dismissUnseenIncoming(
  chatId: string,
  providerId: string,
): void {
  useChatStore.getState().dismissUnseenIncoming(chatId, providerId)
}

export function noteUnseenIncoming(chatId: string, providerId: string): void {
  useChatStore.getState().noteUnseenIncoming(chatId, providerId)
}

export function markIncomingViewed(
  chatId: string,
  providerIds: readonly string[],
): void {
  useChatStore.getState().markIncomingViewed(chatId, providerIds)
}

export function selectChat(chatId: string): void {
  useChatStore.getState().selectChat(chatId)
}

export function clearActiveChat(): void {
  useChatStore.getState().clearActiveChat()
}

export function resetChats(): void {
  useChatStore.getState().reset()
}

function normalizeChat(chat: ChatDraft, current: Chat | undefined): Chat {
  return {
    chatId: chat.chatId,
    phoneNumber: chat.phoneNumber,
    name: chat.name,
    username: chat.username,
    preview:
      chat.preview !== undefined ? chat.preview : (current?.preview ?? null),
    previewForwarded:
      chat.previewForwarded !== undefined
        ? chat.previewForwarded
        : (current?.previewForwarded ?? false),
    lastActivityAt:
      chat.lastActivityAt !== undefined
        ? chat.lastActivityAt
        : (current?.lastActivityAt ?? null),
    unseenIncomingIds:
      chat.unseenIncomingIds !== undefined
        ? [...chat.unseenIncomingIds]
        : [...(current?.unseenIncomingIds ?? [])],
  }
}

function sameChat(current: Chat, next: Chat): boolean {
  return (
    current.phoneNumber === next.phoneNumber &&
    current.name === next.name &&
    current.username === next.username &&
    current.preview === next.preview &&
    current.previewForwarded === next.previewForwarded &&
    current.lastActivityAt === next.lastActivityAt &&
    sameIds(current.unseenIncomingIds, next.unseenIncomingIds)
  )
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  )
}

function filled(value: string | null): string | null {
  if (value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
