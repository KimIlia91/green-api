import type { ChatHistoryEntry } from '@/shared/api'

import { quietJournalEvent, type EditChatPorts } from './edit-apply.ts'
import {
  messageDeletionsFromEntry,
  messageReactionFromEntry,
  unixSecondsToMillis,
} from './map-history.ts'
import {
  applyMessageDeletion,
  applyMessageReaction,
  latestDisplayedActivity,
} from './message.store.ts'

export function applyHistoryEvents(
  entries: readonly ChatHistoryEntry[],
  lastActivityAtFor: (chatId: string) => number | null,
  chat: EditChatPorts,
): void {
  for (const entry of entries) {
    const deletions = messageDeletionsFromEntry(entry)
    const reaction = messageReactionFromEntry(entry)
    if (deletions.length === 0 && reaction === null) {
      continue
    }

    for (const deletion of deletions) {
      applyMessageDeletion(deletion)
    }
    if (reaction !== null) {
      applyMessageReaction(reaction)
    }
    if (deletions.length > 0) {
      chat.rewindDisplayedPreview?.(
        entry.chatId,
        latestDisplayedActivity(entry.chatId),
      )
    }
    quietJournalEvent(
      entry.chatId,
      unixSecondsToMillis(entry.timestamp),
      entry.idMessage,
      lastActivityAtFor(entry.chatId),
      chat,
    )
  }
}
