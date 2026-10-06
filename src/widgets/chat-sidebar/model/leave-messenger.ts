import { resetChats } from '@/entities/chat'
import { resetMessages } from '@/entities/message'
import { cancelIncomingReads } from '@/features/acknowledge-incoming'
import { cancelConnectionRestore } from '@/features/connect-instance'
import { cancelChatProfiles } from '@/features/create-chat'
import { cancelPendingDeletes } from '@/features/delete-messages'
import { disconnectFromInstance } from '@/features/disconnect-instance'
import { cancelChatHistoryLoads } from '@/features/load-chat-history'
import { cancelChatPreviewLoads } from '@/features/load-chat-previews'
import { cancelChatListLoad } from '@/features/load-chats'
import { stopReceiveLoop } from '@/features/receive-notifications'
import { cancelEdit } from '@/features/edit-message'
import { cancelPendingForwards } from '@/features/forward-messages'
import { clearSelection } from '@/features/select-messages'
import { cancelOutgoingMessages, clearDrafts } from '@/features/send-message'

export function leaveMessenger(): void {
  cancelIncomingReads()
  cancelConnectionRestore()
  stopReceiveLoop()
  cancelChatListLoad()
  cancelChatHistoryLoads()
  cancelChatPreviewLoads()
  cancelChatProfiles()
  cancelOutgoingMessages()
  clearDrafts()
  cancelPendingDeletes()
  cancelPendingForwards()
  cancelEdit()
  clearSelection()
  resetMessages()
  resetChats()
  disconnectFromInstance()
}
