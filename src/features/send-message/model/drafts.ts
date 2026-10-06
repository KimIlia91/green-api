import { create } from 'zustand'

import type { ReplySelection } from '@/entities/message'

type ChatDraft = {
  text: string
  reply: ReplySelection | null
}

type DraftState = {
  draftsByChatId: Record<string, ChatDraft>
}

type DraftStore = DraftState & {
  setDraft: (chatId: string, text: string) => void
  setReply: (chatId: string, reply: ReplySelection) => void
  clearReply: (chatId: string) => void
  clearDraft: (chatId: string) => void
  clearDrafts: () => void
}

const emptyDrafts = {
  draftsByChatId: {},
} satisfies DraftState

export const useDraftStore = create<DraftStore>()((set) => ({
  ...emptyDrafts,
  setDraft: (chatId, text) => {
    set((state) => {
      const current = state.draftsByChatId[chatId]
      if (current?.text === text) {
        return state
      }

      return {
        draftsByChatId: {
          ...state.draftsByChatId,
          [chatId]: { text, reply: current?.reply ?? null },
        },
      }
    })
  },
  setReply: (chatId, reply) => {
    set((state) => {
      const current = state.draftsByChatId[chatId]
      if (sameReply(current?.reply ?? null, reply)) {
        return state
      }

      return {
        draftsByChatId: {
          ...state.draftsByChatId,
          [chatId]: { text: current?.text ?? '', reply },
        },
      }
    })
  },
  clearReply: (chatId) => {
    set((state) => {
      const current = state.draftsByChatId[chatId]
      if (current === undefined || current.reply === null) {
        return state
      }

      if (current.text === '') {
        const draftsByChatId = { ...state.draftsByChatId }
        delete draftsByChatId[chatId]
        return { draftsByChatId }
      }

      return {
        draftsByChatId: {
          ...state.draftsByChatId,
          [chatId]: { ...current, reply: null },
        },
      }
    })
  },
  clearDraft: (chatId) => {
    set((state) => {
      if (state.draftsByChatId[chatId] === undefined) {
        return state
      }

      const draftsByChatId = { ...state.draftsByChatId }
      delete draftsByChatId[chatId]
      return { draftsByChatId }
    })
  },
  clearDrafts: () => {
    set(emptyDrafts)
  },
}))

export const selectDraft =
  (chatId: string) =>
  (state: DraftState): string =>
    state.draftsByChatId[chatId]?.text ?? ''

export const selectReply =
  (chatId: string) =>
  (state: DraftState): ReplySelection | null =>
    state.draftsByChatId[chatId]?.reply ?? null

export function setDraft(chatId: string, text: string): void {
  useDraftStore.getState().setDraft(chatId, text)
}

export function setReply(chatId: string, reply: ReplySelection): void {
  useDraftStore.getState().setReply(chatId, reply)
}

export function clearReply(chatId: string): void {
  useDraftStore.getState().clearReply(chatId)
}

export function clearDraft(chatId: string): void {
  useDraftStore.getState().clearDraft(chatId)
}

export function clearDrafts(): void {
  useDraftStore.getState().clearDrafts()
}

function sameReply(
  current: ReplySelection | null,
  next: ReplySelection,
): boolean {
  return (
    current !== null &&
    current.providerId === next.providerId &&
    current.chatId === next.chatId &&
    current.composerLabel === next.composerLabel &&
    current.bubbleAuthor === next.bubbleAuthor &&
    current.excerpt === next.excerpt
  )
}
