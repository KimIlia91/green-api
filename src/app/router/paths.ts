export function chatPath(chatId: string): string {
  return `/chats/${encodeURIComponent(chatId)}`
}

export function isChatLocation(pathname: string, chatId: string): boolean {
  return pathname === chatPath(chatId)
}
