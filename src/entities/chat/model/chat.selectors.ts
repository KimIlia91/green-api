import type { ChatState } from './chat.types.ts'

let cachedKey = ''
let cachedIds: string[] = []

export function selectChatIds(state: ChatState): string[] {
  const key = activityKey(state)
  if (key === cachedKey) {
    return cachedIds
  }

  const ordered = orderedChatIds(state)
  if (sameIds(ordered, cachedIds)) {
    cachedKey = key
    return cachedIds
  }

  cachedIds = sameIds(ordered, state.chatIds) ? state.chatIds : ordered
  cachedKey = key
  return cachedIds
}

function orderedChatIds(state: ChatState): string[] {
  return state.chatIds
    .map((chatId, index) => ({
      chatId,
      index,
      at: state.chatsById[chatId]?.lastActivityAt ?? null,
    }))
    .sort((left, right) => {
      if (left.at === right.at) {
        return left.index - right.index
      }
      if (left.at === null) {
        return 1
      }
      if (right.at === null) {
        return -1
      }
      return right.at - left.at
    })
    .map((item) => item.chatId)
}

function activityKey(state: ChatState): string {
  let key = ''
  for (const chatId of state.chatIds) {
    const at = state.chatsById[chatId]?.lastActivityAt
    key += chatId
    key += '\0'
    key += at === null || at === undefined ? '' : String(at)
    key += '\n'
  }
  return key
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((chatId, index) => chatId === right[index])
}

export const selectChatsById = (state: ChatState): ChatState['chatsById'] =>
  state.chatsById

export const selectActiveChatId = (state: ChatState): string | null =>
  state.activeChatId

export const selectActiveChat = (state: ChatState) => {
  if (state.activeChatId === null) {
    return null
  }

  return state.chatsById[state.activeChatId] ?? null
}

export const selectChatById = (chatId: string) => (state: ChatState) =>
  state.chatsById[chatId]
