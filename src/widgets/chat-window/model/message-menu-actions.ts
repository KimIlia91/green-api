import {
  canEditMessage,
  type Message,
  type MessageDirection,
} from '@/entities/message'
import { messageCopySource } from '@/features/copy-message-text'
import { deleteBlockReason } from '@/features/delete-messages'
import { forwardBlockReason } from '@/features/forward-messages'
import { replySelectionFor } from '@/features/reply-to-message'
import { canSelectMessage } from '@/features/select-messages'

export const messageMenuActionNames = [
  'reply',
  'edit',
  'copy',
  'forward',
  'delete',
  'select',
] as const

export type MessageMenuAction = (typeof messageMenuActionNames)[number]

export type MessageMenuSubject = {
  providerId: string | null
  chatId: string
  text: string
  stickerUrl: string | null
  direction: MessageDirection
  sentAt: number | null
}

export function messageMenuActions(
  message: MessageMenuSubject,
  options: {
    activeChatId: string
    contactTitle: string
    now: number
  },
): MessageMenuAction[] {
  const stored = asMessage(message)
  const actions: MessageMenuAction[] = []

  if (
    replySelectionFor({
      message,
      activeChatId: options.activeChatId,
      contactTitle: options.contactTitle,
      selfName: null,
    }) !== null
  ) {
    actions.push('reply')
  }
  if (canEditMessage(message, options.now)) {
    actions.push('edit')
  }
  if (messageCopySource(message) !== null) {
    actions.push('copy')
  }
  if (forwardBlockReason([stored]) === null) {
    actions.push('forward')
  }
  if (deleteBlockReason([stored]) === null) {
    actions.push('delete')
  }
  if (canSelectMessage(message)) {
    actions.push('select')
  }

  return actions
}

function asMessage(message: MessageMenuSubject): Message {
  return {
    localId: 'menu',
    providerId: message.providerId,
    chatId: message.chatId,
    text: message.text,
    stickerUrl: message.stickerUrl,
    stickerMimeType: null,
    direction: message.direction,
    createdAt: message.sentAt ?? 0,
    sentAt: message.sentAt,
    sendState: null,
    errorText: null,
  }
}
