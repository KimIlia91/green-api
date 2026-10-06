import { clearActiveChat, selectChat, useChatStore } from '@/entities/chat'

export function syncRouteChat(routeChatId: string | null): void {
  const state = useChatStore.getState()
  if (routeChatId === null || state.chatsById[routeChatId] === undefined) {
    if (state.activeChatId !== null) {
      clearActiveChat()
    }
    return
  }

  selectChat(routeChatId)
}
