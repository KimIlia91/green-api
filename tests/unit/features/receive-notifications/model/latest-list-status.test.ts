import { beforeEach, describe, expect, it } from 'vitest'

import {
  recordChatActivity,
  resetChats,
  selectChatIds,
  upsertChat,
  useChatStore,
} from '@/entities/chat'
import {
  addMessage,
  mergeChatHistory,
  resetMessages,
  selectLatestOutgoingState,
  useMessageStore,
  type Message,
} from '@/entities/message'
import { clearSession, establishSession } from '@/entities/session'
import type { MaxNotification } from '@/shared/api'

import { applyNotification } from '@/features/receive-notifications/model/apply-notification.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('latest outgoing status in the chat list', () => {
  beforeEach(() => {
    resetMessages()
    resetChats()
    clearSession()
    establishSession(connection, 'authorized')
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: 'Анна',
      username: null,
    })
    upsertChat({
      chatId: '20000000',
      phoneNumber: '375291112233',
      name: 'Борис',
      username: null,
    })
  })

  it('reads read and delivered from the latest outgoing message and hides it for incoming', () => {
    addMessage(message('read-row', '10000000', 'outgoing', 'read', 2_000))
    addMessage(message('in-row', '20000000', 'incoming', null, 2_000))

    expect(
      selectLatestOutgoingState('10000000')(useMessageStore.getState()),
    ).toBe('read')
    expect(
      selectLatestOutgoingState('20000000')(useMessageStore.getState()),
    ).toBeNull()
    addMessage(message('blank', '20000000', 'outgoing', null, 3_000))
    expect(
      selectLatestOutgoingState('20000000')(useMessageStore.getState()),
    ).toBeNull()

    addMessage(
      message('delivered-row', '10000000', 'outgoing', 'delivered', 3_000),
    )
    expect(
      selectLatestOutgoingState('10000000')(useMessageStore.getState()),
    ).toBe('delivered')
  })

  it('follows queued, delivered and read without opening the chat or resorting it', () => {
    addMessage(
      message('local-1', '10000000', 'outgoing', 'queued', 3_000, 'provider-1'),
    )
    addMessage(
      message('other', '20000000', 'outgoing', 'sent', 1_000, 'provider-2'),
    )
    recordChatActivity('10000000', { preview: 'последнее', at: 3_000 })
    recordChatActivity('20000000', { preview: 'раньше', at: 1_000 })
    const order = selectChatIds(useChatStore.getState())

    applyNotification(status('delivered'))
    expect(
      selectLatestOutgoingState('10000000')(useMessageStore.getState()),
    ).toBe('delivered')
    applyNotification(status('read'))

    expect(useChatStore.getState().activeChatId).toBeNull()
    expect(
      selectLatestOutgoingState('10000000')(useMessageStore.getState()),
    ).toBe('read')
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'последнее',
      lastActivityAt: 3_000,
    })
    expect(selectChatIds(useChatStore.getState())).toBe(order)
  })

  it('keeps the latest indicator when an older outgoing message changes status', () => {
    addMessage(
      message('older', '10000000', 'outgoing', 'queued', 1_000, 'old-id'),
    )
    addMessage(
      message('latest', '10000000', 'outgoing', 'sent', 4_000, 'new-id'),
    )
    recordChatActivity('10000000', { preview: 'новое', at: 4_000 })

    applyNotification(status('delivered', undefined, 'old-id'))

    expect(
      selectLatestOutgoingState('10000000')(useMessageStore.getState()),
    ).toBe('sent')
    expect(useChatStore.getState().chatsById['10000000']?.preview).toBe('новое')
  })

  it('drops the outgoing indicator when a newer incoming message becomes the preview', () => {
    addMessage(message('out', '10000000', 'outgoing', 'read', 2_000, 'out-id'))
    recordChatActivity('10000000', { preview: 'исходящее', at: 2_000 })

    applyNotification(incoming('in-id', 'ответ', 5))

    expect(
      selectLatestOutgoingState('10000000')(useMessageStore.getState()),
    ).toBeNull()
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'ответ',
      lastActivityAt: 5_000,
    })
  })

  it('does not let history roll a read receipt back to delivered', () => {
    addMessage(
      message(
        'local-read',
        '10000000',
        'outgoing',
        'read',
        4_000,
        'provider-read',
      ),
    )
    recordChatActivity('10000000', { preview: 'готово', at: 4_000 })

    mergeChatHistory(
      '10000000',
      [
        {
          providerId: 'provider-read',
          chatId: '10000000',
          text: 'готово',
          stickerUrl: null,
          stickerMimeType: null,
          direction: 'outgoing',
          createdAt: 4_000,
          sentAt: null,
          sendState: 'delivered',
        },
      ],
      () => 'history-copy',
    )

    expect(
      selectLatestOutgoingState('10000000')(useMessageStore.getState()),
    ).toBe('read')
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'готово',
      lastActivityAt: 4_000,
    })
  })
})

function message(
  localId: string,
  chatId: string,
  direction: Message['direction'],
  sendState: Message['sendState'],
  createdAt: number,
  providerId: string | null = null,
): Message {
  return {
    localId,
    providerId,
    chatId,
    text: localId,
    stickerUrl: null,
    stickerMimeType: null,
    direction,
    createdAt,
    sentAt: createdAt,
    sendState,
    errorText: null,
  }
}

function status(
  value: string,
  description?: string,
  idMessage = 'provider-1',
): MaxNotification {
  return {
    typeWebhook: 'outgoingMessageStatus',
    timestamp: 1_755_591_519,
    idMessage,
    chatId: '10000000',
    status: value,
    ...(description === undefined ? {} : { description }),
  }
}

function incoming(
  idMessage: string,
  text: string,
  timestamp: number,
): MaxNotification {
  return {
    typeWebhook: 'incomingMessageReceived',
    timestamp,
    idMessage,
    senderData: { chatId: '10000000' },
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: text },
    },
  }
}
