import { create } from 'zustand'

import { hasSelectableText } from '@/entities/message'

export type MessageSelection = {
  chatId: string | null
  localIds: string[]
}

type SelectionState = MessageSelection & {
  begin: (chatId: string, localId: string) => void
  toggle: (chatId: string, localId: string) => void
  retain: (localIds: readonly string[]) => void
  clear: () => void
}

const emptySelection = {
  chatId: null,
  localIds: [],
} satisfies MessageSelection

export const useSelectionStore = create<SelectionState>()((set, get) => ({
  ...emptySelection,
  begin: (chatId, localId) => {
    set({ chatId, localIds: [localId] })
  },
  toggle: (chatId, localId) => {
    const current = get()
    if (current.chatId !== chatId) {
      set({ chatId, localIds: [localId] })
      return
    }

    const selected = current.localIds.includes(localId)
    set({
      chatId,
      localIds: selected
        ? current.localIds.filter((id) => id !== localId)
        : [...current.localIds, localId],
    })
  },
  retain: (localIds) => {
    const current = get()
    if (current.chatId === null) {
      return
    }

    const allowed = new Set(localIds)
    const next = current.localIds.filter((id) => allowed.has(id))
    if (next.length === current.localIds.length) {
      return
    }

    set({ chatId: current.chatId, localIds: next })
  },
  clear: () => {
    set(emptySelection)
  },
}))

export function selectMessageSelection(
  state: SelectionState,
): MessageSelection {
  return { chatId: state.chatId, localIds: state.localIds }
}

export function beginSelection(chatId: string, localId: string): void {
  useSelectionStore.getState().begin(chatId, localId)
}

export function toggleSelection(chatId: string, localId: string): void {
  useSelectionStore.getState().toggle(chatId, localId)
}

export function retainSelection(localIds: readonly string[]): void {
  useSelectionStore.getState().retain(localIds)
}

export function clearSelection(): void {
  useSelectionStore.getState().clear()
}

export function canSelectMessage(message: {
  text: string
  stickerUrl: string | null
}): boolean {
  return hasSelectableText(message)
}

export function selectedInThreadOrder(
  threadIds: readonly string[],
  selectedIds: readonly string[],
): string[] {
  const selected = new Set(selectedIds)
  return threadIds.filter((id) => selected.has(id))
}
