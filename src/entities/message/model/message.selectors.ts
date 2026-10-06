import type {
  Message,
  MessageState,
  OutgoingSendState,
} from './message.types.ts'

const emptyMessageIds: string[] = []

export const selectMessageIds =
  (chatId: string) =>
  (state: MessageState): string[] =>
    state.messageIdsByChatId[chatId] ?? emptyMessageIds

export const selectMessageById =
  (localId: string) =>
  (state: MessageState): Message | undefined =>
    state.messagesById[localId]

export const selectHistoryStamp =
  (chatId: string) =>
  (state: MessageState): number =>
    state.historyStampByChatId[chatId] ?? 0

export const selectLocalIdByProviderId =
  (providerId: string) =>
  (state: MessageState): string | undefined =>
    state.localIdByProviderId[providerId]

export const selectLatestOutgoingState =
  (chatId: string) =>
  (state: MessageState): OutgoingSendState | null => {
    const ids = state.messageIdsByChatId[chatId]
    if (ids === undefined || ids.length === 0) {
      return null
    }

    let latest: Message | undefined
    for (const localId of ids) {
      const message = state.messagesById[localId]
      if (message === undefined) {
        continue
      }
      if (latest === undefined || message.createdAt >= latest.createdAt) {
        latest = message
      }
    }

    if (
      latest === undefined ||
      latest.direction !== 'outgoing' ||
      latest.sendState === null
    ) {
      return null
    }

    return latest.sendState
  }
