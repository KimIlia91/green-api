export type Chat = {
  chatId: string
  phoneNumber: string | null
  name: string | null
  username: string | null
  preview: string | null
  previewForwarded: boolean
  lastActivityAt: number | null
  unseenIncomingIds: readonly string[]
}

export type ChatDraft = {
  chatId: string
  phoneNumber: string | null
  name: string | null
  username: string | null
  preview?: string | null
  previewForwarded?: boolean
  lastActivityAt?: number | null
  unseenIncomingIds?: readonly string[]
}

export type RemoteChatInput = {
  chatId: string
  name: string | null
  phoneNumber: string | null
}

export type ChatActivity = {
  preview: string
  at: number
  forwarded?: boolean
}

export type ChatState = {
  chatsById: Record<string, Chat>
  chatIds: string[]
  activeChatId: string | null
  viewedIncomingIds: readonly string[]
}
