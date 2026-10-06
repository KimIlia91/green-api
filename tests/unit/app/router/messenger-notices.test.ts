import { beforeEach, describe, expect, it } from 'vitest'

import { resetChats, upsertChat } from '@/entities/chat'
import { addMessage, resetMessages, useMessageStore } from '@/entities/message'
import { clearSession, establishSession } from '@/entities/session'
import { applyNotification } from '@/features/receive-notifications'
import { sendChatMessage } from '@/features/send-message'
import type { MaxNotification } from '@/shared/api'
import { resetToastStore, useToastStore } from '@/shared/lib/toast'

import { bindMessengerSendNotices } from '@/app/router/messenger-notices.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('bindMessengerSendNotices', () => {
  beforeEach(() => {
    resetToastStore()
    resetMessages()
    resetChats()
    clearSession()
    establishSession(connection, 'authorized')
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: null,
      username: null,
    })
  })

  it('toasts one queued text refusal and ignores a duplicate status', async () => {
    const unbind = bindMessengerSendNotices()
    await sendChatMessage('10000000', 'секретный текст', {
      createId: () => 'local-1',
      client: {
        sendMessage: () => Promise.resolve({ idMessage: 'provider-1' }),
      },
    })

    applyNotification(status('failed', 'https://console.green-api.com abc123'))
    applyNotification(status('failed', 'секретный текст'))

    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      sendState: 'failed',
      errorText: null,
    })
    expect(toastTexts()).toEqual(['Сообщение не доставлено.'])
    expect(toastTexts()[0]).not.toMatch(/секретный|https|abc123/)
    unbind()
  })

  it('does not toast a refusal after the messenger notices are unbound', async () => {
    const unbind = bindMessengerSendNotices()
    unbind()
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'local-1',
      client: {
        sendMessage: () => Promise.resolve({ idMessage: 'provider-1' }),
      },
    })

    applyNotification(status('noAccount'))

    expect(useToastStore.getState().toasts).toEqual([])
    expect(useMessageStore.getState().messagesById['local-1']?.sendState).toBe(
      'failed',
    )
  })

  it('does not toast an outgoing refusal for a message this scenario did not send', () => {
    const unbind = bindMessengerSendNotices()
    addMessage({
      localId: 'local-sticker',
      providerId: 'provider-1',
      chatId: '10000000',
      text: '',
      stickerUrl: 'https://example.com/sticker.webp',
      stickerMimeType: 'image/webp',
      direction: 'outgoing',
      createdAt: 1,
      sentAt: 1,
      sendState: 'queued',
      errorText: null,
    })

    applyNotification(status('failed'))

    expect(useToastStore.getState().toasts).toEqual([])
    unbind()
  })
})

function toastTexts(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message)
}

function status(value: string, description?: string): MaxNotification {
  return {
    typeWebhook: 'outgoingMessageStatus',
    timestamp: 1_755_591_519,
    idMessage: 'provider-1',
    chatId: '10000000',
    status: value,
    ...(description === undefined ? {} : { description }),
  }
}
