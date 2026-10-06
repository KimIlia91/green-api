import { beforeEach, describe, expect, it } from 'vitest'

import {
  markIncomingViewed,
  noteUnseenIncoming,
  recordChatActivity,
  resetChats,
  selectChat,
  selectChatIds,
  upsertChat,
  useChatStore,
} from '@/entities/chat'
import {
  addMessage,
  applyMessageEdit,
  mergeChatHistory,
  resetMessages,
  unsupportedMessageText,
  updateMessage,
  useMessageStore,
} from '@/entities/message'
import { clearSession, establishSession } from '@/entities/session'
import type { MaxNotification } from '@/shared/api'

import { applyNotification } from '@/features/receive-notifications/model/apply-notification.ts'
import { bindOutgoingSendRefusal } from '@/features/receive-notifications/model/outgoing-refusal.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('applyNotification', () => {
  beforeEach(() => {
    bindOutgoingSendRefusal(null)
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
    addMessage({
      localId: 'local-1',
      providerId: 'provider-1',
      chatId: '10000000',
      text: 'hello',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_700_000_000_000,
      sentAt: null,
      sendState: 'queued',
      errorText: null,
    })
  })

  it('replaces the queue label with a documented delivery status', () => {
    applyNotification(status('delivered'))

    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      sendState: 'delivered',
      errorText: null,
    })
  })

  it('moves delivered to read and does not move read back', () => {
    applyNotification(status('delivered'))
    applyNotification(status('read'))
    applyNotification(status('delivered'))

    expect(useMessageStore.getState().messagesById['local-1']?.sendState).toBe(
      'read',
    )
  })

  it('marks a documented refusal instead of leaving the message queued', () => {
    applyNotification(
      status('failed', 'server rejected the text without a link'),
    )
    const failed = useMessageStore.getState().messagesById['local-1']
    expect(failed).toMatchObject({
      sendState: 'failed',
      errorText:
        'Сообщение не доставлено на сервер MAX. server rejected the text without a link',
    })

    applyNotification(status('noAccount'))
    expect(useMessageStore.getState().messagesById['local-1']?.errorText).toBe(
      'На номере получателя нет аккаунта MAX.',
    )

    applyNotification(status('notInGroup'))
    expect(useMessageStore.getState().messagesById['local-1']?.errorText).toBe(
      'Отправитель не участник группового чата.',
    )
  })

  it('publishes an outgoing refusal without publishing delivery', () => {
    const calls: Array<{ localId: string; status: string }> = []
    bindOutgoingSendRefusal((refusal) => {
      calls.push(refusal)
    })

    applyNotification(status('delivered'))
    applyNotification(status('failed', 'see https://console.green-api.com'))
    applyNotification(status('noAccount'))

    expect(calls).toEqual([
      { localId: 'local-1', status: 'failed' },
      { localId: 'local-1', status: 'noAccount' },
    ])
  })

  it('hides a description that contains a URL or the token', () => {
    applyNotification(status('failed', 'see https://console.green-api.com'))
    expect(useMessageStore.getState().messagesById['local-1']?.errorText).toBe(
      'Сообщение не доставлено на сервер MAX.',
    )

    applyNotification(status('failed', 'token abc123 leaked'))
    expect(useMessageStore.getState().messagesById['local-1']?.errorText).toBe(
      'Сообщение не доставлено на сервер MAX.',
    )
  })

  it('leaves an unrecognized status queued', () => {
    applyNotification(status('sent'))

    expect(useMessageStore.getState().messagesById['local-1']?.sendState).toBe(
      'queued',
    )
  })

  it('stores one incoming text and ignores the same idMessage', () => {
    const incoming = incomingText('incoming-1', 'Ответ')
    applyNotification(incoming, { createId: () => 'local-in' })
    applyNotification(incoming, { createId: () => 'local-in-2' })

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
      'local-in',
    ])
    expect(useMessageStore.getState().messagesById['local-in']).toMatchObject({
      direction: 'incoming',
      text: 'Ответ',
      providerId: 'incoming-1',
      sendState: null,
      createdAt: 1_755_591_519_000,
      sentAt: 1_755_591_519_000,
    })
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Ответ',
      unseenIncomingIds: ['incoming-1'],
    })

    selectChat('10000000')
    applyNotification(incomingText('incoming-open', 'На экране'), {
      createId: () => 'local-open',
    })
    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual(['incoming-1', 'incoming-open'])
    markIncomingViewed('10000000', ['incoming-1', 'incoming-open'])
    applyNotification(incoming, { createId: () => 'local-in-3' })
    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual([])
  })

  it('stores an incoming sticker and previews it without a caption', () => {
    applyNotification(
      {
        typeWebhook: 'incomingMessageReceived',
        timestamp: 1_755_591_519,
        idMessage: 'sticker-1',
        senderData: { chatId: '10000000' },
        messageData: {
          typeMessage: 'stickerMessage',
          fileMessageData: {
            downloadUrl: 'https://media.example/sticker.png',
            mimeType: 'image/png',
            caption: '',
          },
        },
      },
      { createId: () => 'local-sticker' },
    )

    expect(
      useMessageStore.getState().messagesById['local-sticker'],
    ).toMatchObject({
      text: '',
      stickerUrl: 'https://media.example/sticker.png',
      stickerMimeType: 'image/png',
      direction: 'incoming',
    })
    expect(useChatStore.getState().chatsById['10000000']?.preview).toBe(
      'Стикер',
    )
    expect(
      useChatStore.getState().chatsById['10000000']?.previewForwarded,
    ).toBe(false)
    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual(['sticker-1'])
  })

  it('replaces a history stub with the sticker file from the notification', () => {
    addMessage({
      localId: 'local-sticker',
      providerId: 'sticker-1',
      chatId: '10000000',
      text: unsupportedMessageText,
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_755_591_519_000,
      sentAt: 1_755_591_519_000,
      sendState: 'delivered',
      errorText: null,
    })

    applyNotification(
      {
        typeWebhook: 'outgoingMessageReceived',
        timestamp: 1_755_591_519,
        idMessage: 'sticker-1',
        senderData: {
          chatId: '10000000',
          chatName: null,
          chatType: 'user',
          senderPhoneNumber: null,
        },
        messageData: {
          typeMessage: 'stickerMessage',
          fileMessageData: {
            downloadUrl: 'https://media.example/sticker.png',
            mimeType: null,
            caption: '',
          },
        },
      },
      { createId: () => 'should-not-create' },
    )

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
      'local-sticker',
    ])
    expect(
      useMessageStore.getState().messagesById['should-not-create'],
    ).toBeUndefined()
    expect(
      useMessageStore.getState().messagesById['local-sticker'],
    ).toMatchObject({
      text: '',
      stickerUrl: 'https://media.example/sticker.png',
      stickerMimeType: null,
      direction: 'outgoing',
    })
    expect(useChatStore.getState().chatsById['10000000']?.preview).toBe(
      'Стикер',
    )
  })

  it('marks a forwarded sticker as the last chat message', () => {
    applyNotification(
      {
        typeWebhook: 'outgoingMessageReceived',
        timestamp: 1_755_591_519,
        idMessage: 'sticker-forward',
        senderData: {
          chatId: '10000000',
          chatName: null,
          chatType: 'user',
          senderPhoneNumber: null,
        },
        messageData: {
          typeMessage: 'stickerMessage',
          fileMessageData: {
            downloadUrl: 'https://media.example/sticker.webp',
            mimeType: 'image/webp',
            caption: '',
            isForwarded: true,
            forwardingScore: 1,
          },
        },
      },
      { createId: () => 'local-sticker-forward' },
    )

    expect(
      useMessageStore.getState().messagesById['local-sticker-forward'],
    ).toMatchObject({
      forwarded: true,
      forwardingScore: 1,
      stickerUrl: 'https://media.example/sticker.webp',
    })
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Стикер',
      previewForwarded: true,
    })
    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual([])
  })

  it('does not create a chat for an incoming message from an unknown chat', () => {
    applyNotification(incomingText('incoming-2', 'Чужой', '999'))

    expect(useChatStore.getState().chatIds).toEqual(['10000000'])
    expect(useMessageStore.getState().messageIdsByChatId['999']).toBeUndefined()
  })

  it('shows text sent from official MAX in the open self chat', () => {
    upsertChat({
      chatId: '10000000',
      phoneNumber: null,
      name: 'Избранное',
      username: null,
    })
    selectChat('10000000')

    applyNotification(officialText('self-1', 'Себе'), {
      createId: () => 'local-self',
    })

    expect(useMessageStore.getState().messagesById['local-self']).toMatchObject(
      {
        direction: 'outgoing',
        text: 'Себе',
        providerId: 'self-1',
        sendState: 'sent',
        chatId: '10000000',
        createdAt: 1_755_591_519_000,
        sentAt: 1_755_591_519_000,
      },
    )
    expect(useChatStore.getState().activeChatId).toBe('10000000')
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Себе',
      unseenIncomingIds: [],
    })
  })

  it('stores an external outgoing text in another personal chat', () => {
    upsertChat({
      chatId: '20000000',
      phoneNumber: '375291112233',
      name: 'Борис',
      username: null,
    })
    selectChat('10000000')
    recordChatActivity('10000000', {
      preview: 'раньше',
      at: 1,
    })

    applyNotification(officialText('out-1', 'Из MAX', '20000000'), {
      createId: () => 'local-out',
    })

    expect(useMessageStore.getState().messagesById['local-out']).toMatchObject({
      direction: 'outgoing',
      sendState: 'sent',
      chatId: '20000000',
    })
    expect(useChatStore.getState().activeChatId).toBe('10000000')
    expect(
      useChatStore.getState().chatsById['20000000']?.unseenIncomingIds,
    ).toEqual([])
    expect(selectChatIds(useChatStore.getState())).toEqual([
      '20000000',
      '10000000',
    ])
  })

  it('keeps a URL in an external outgoing message', () => {
    applyNotification(
      {
        typeWebhook: 'outgoingMessageReceived',
        timestamp: 1_755_591_519,
        idMessage: 'url-1',
        senderData: {
          chatId: '10000000',
          chatName: 'Избранное',
          chatType: 'user',
          senderPhoneNumber: null,
        },
        messageData: {
          typeMessage: 'extendedTextMessage',
          extendedTextMessageData: {
            text: 'Документация https://green-api.com/v3/docs/',
          },
        },
      },
      { createId: () => 'local-url' },
    )

    expect(useMessageStore.getState().messagesById['local-url']?.text).toBe(
      'Документация https://green-api.com/v3/docs/',
    )
  })

  it('ignores a repeated external outgoing event', () => {
    const event = officialText('out-repeat', 'ещё раз')
    applyNotification(event, { createId: () => 'local-once' })
    const order = selectChatIds(useChatStore.getState())
    applyNotification(event, { createId: () => 'local-twice' })

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
      'local-once',
    ])
    expect(selectChatIds(useChatStore.getState())).toBe(order)
  })

  it('merges later history without a duplicate and keeps read', () => {
    applyNotification(officialText('history-1', 'из MAX'), {
      createId: () => 'local-history',
    })
    updateMessage('local-history', { sendState: 'read' })

    mergeChatHistory(
      '10000000',
      [
        {
          providerId: 'history-1',
          chatId: '10000000',
          text: 'из MAX',
          stickerUrl: null,
          stickerMimeType: null,
          direction: 'outgoing',
          createdAt: 1_755_591_519_000,
          sentAt: null,
          sendState: 'sent',
        },
      ],
      () => 'history-new',
    )

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
      'local-history',
    ])
    expect(
      useMessageStore.getState().messagesById['local-history']?.sendState,
    ).toBe('read')
  })

  it('attaches an API notification that arrives before SendMessage responds', () => {
    addMessage({
      localId: 'local-api',
      providerId: null,
      chatId: '10000000',
      text: 'из приложения',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 5_000,
      sentAt: null,
      sendState: 'sending',
      errorText: null,
    })
    recordChatActivity('10000000', {
      preview: 'из приложения',
      at: 5_000,
    })

    applyNotification(
      officialText(
        'api-1',
        'из приложения',
        '10000000',
        'outgoingAPIMessageReceived',
      ),
      { createId: () => 'local-api-duplicate' },
    )
    updateMessage('local-api', { providerId: 'api-1', sendState: 'queued' })

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
      'local-api',
    ])
    expect(useMessageStore.getState().messagesById['local-api']).toMatchObject({
      localId: 'local-api',
      providerId: 'api-1',
      sendState: 'queued',
    })
    expect(useChatStore.getState().chatsById['10000000']?.lastActivityAt).toBe(
      5_000,
    )
  })

  it('lifts an inactive chat when an incoming message arrives', () => {
    upsertChat({
      chatId: '20000000',
      phoneNumber: '375291112233',
      name: 'Борис',
      username: null,
    })
    selectChat('10000000')
    recordChatActivity('10000000', {
      preview: 'старое',
      at: 1,
    })

    applyNotification(incomingText('incoming-b', 'новое', '20000000'))

    expect(useChatStore.getState().activeChatId).toBe('10000000')
    expect(
      useChatStore.getState().chatsById['20000000']?.unseenIncomingIds,
    ).toEqual(['incoming-b'])
    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual([])
    expect(selectChatIds(useChatStore.getState())).toEqual([
      '20000000',
      '10000000',
    ])
  })

  it('does not let an older event or a delivery status change chat order', () => {
    upsertChat({
      chatId: '20000000',
      phoneNumber: '375291112233',
      name: 'Борис',
      username: null,
    })
    recordChatActivity('20000000', {
      preview: 'свежее',
      at: 9_000_000_000_000,
    })
    const order = selectChatIds(useChatStore.getState())

    applyNotification(incomingText('old-1', 'давно', '10000000'))
    applyNotification(status('delivered'))
    applyNotification(status('read'))

    expect(useChatStore.getState().chatsById['20000000']?.preview).toBe(
      'свежее',
    )
    expect(useMessageStore.getState().messagesById['local-1']?.sendState).toBe(
      'read',
    )
    expect(selectChatIds(useChatStore.getState())).toBe(order)
  })

  it('adds an unknown personal chat without opening it', () => {
    selectChat('10000000')
    applyNotification(officialText('new-1', 'первый', '30000000'), {
      createId: () => 'local-new',
    })
    applyNotification(officialText('group-1', 'группа', '-69876543210123'))

    expect(useChatStore.getState().activeChatId).toBe('10000000')
    expect(useChatStore.getState().chatsById['30000000']).toMatchObject({
      name: 'Анна',
      phoneNumber: '79876543210',
      preview: 'первый',
    })
    expect(useChatStore.getState().chatsById['-69876543210123']).toBeUndefined()
    expect(
      useMessageStore.getState().messagesById['local-new']?.direction,
    ).toBe('outgoing')
  })

  it('merges an API quote into the optimistic reply without a second row', () => {
    addMessage({
      localId: 'local-reply',
      providerId: null,
      chatId: '10000000',
      text: 'Цитируем это',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_700_000_000_000,
      sentAt: null,
      sendState: 'sending',
      errorText: null,
      quote: {
        sourceId: '116413118178426437',
        excerpt: 'исходный текст',
        authorName: 'Вы',
        typeMessage: 'textMessage',
      },
    })

    applyNotification(
      {
        typeWebhook: 'outgoingAPIMessageReceived',
        timestamp: 1_763_115_112,
        idMessage: '1763115112345',
        senderData: {
          chatId: '10000000',
          chatName: 'Анна',
          chatType: 'user',
          senderPhoneNumber: 0,
        },
        messageData: {
          typeMessage: 'quotedMessage',
          extendedTextMessageData: {
            text: 'Цитируем это',
            stanzaId: '116413118178426437',
            participant: '10000000',
          },
          quote: {
            sourceId: '116413118178426437',
            participant: '10000000',
            typeMessage: null,
            excerpt: null,
          },
        },
      },
      { createId: () => 'duplicate' },
    )

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
      'local-reply',
    ])
    expect(
      useMessageStore.getState().messagesById['local-reply'],
    ).toMatchObject({
      localId: 'local-reply',
      providerId: '1763115112345',
      text: 'Цитируем это',
      quote: {
        sourceId: '116413118178426437',
        excerpt: 'исходный текст',
        authorName: 'Вы',
      },
    })
  })

  it('stores a quoted incoming notification without using the quote as the message', () => {
    applyNotification(
      {
        typeWebhook: 'incomingMessageReceived',
        timestamp: 1_588_091_580,
        idMessage: '1763115112345',
        senderData: { chatId: '10000000' },
        messageData: {
          typeMessage: 'quotedMessage',
          extendedTextMessageData: {
            text: 'Цитируем это',
            stanzaId: '116413118178426437',
            participant: '10000000',
          },
          quote: {
            sourceId: '116413118178426437',
            participant: '10000000',
            typeMessage: 'textMessage',
            excerpt: 'исходный текст',
          },
        },
      },
      { createId: () => 'local-in' },
    )

    expect(useMessageStore.getState().messagesById['local-in']).toMatchObject({
      text: 'Цитируем это',
      direction: 'incoming',
      quote: {
        sourceId: '116413118178426437',
        excerpt: 'исходный текст',
      },
    })
  })

  it('updates the original message from an edit webhook and does not add a bubble', () => {
    updateMessage('local-1', {
      quote: {
        sourceId: 'quote-1',
        excerpt: 'цитата',
        authorName: 'Вы',
        typeMessage: 'textMessage',
      },
    })
    recordChatActivity('10000000', {
      preview: 'hello',
      at: 1_700_000_000_000,
    })
    const order = selectChatIds(useChatStore.getState())

    applyNotification(
      editWebhook('outgoingAPIMessageReceived', 'event-1', 'Стало'),
    )
    applyNotification(editWebhook('outgoingMessageReceived', 'event-2', 'Ещё'))

    const state = useMessageStore.getState()
    expect(state.messageIdsByChatId['10000000']).toEqual(['local-1'])
    expect(state.messagesById['local-1']).toMatchObject({
      localId: 'local-1',
      providerId: 'provider-1',
      text: 'Ещё',
      sentAt: null,
      createdAt: 1_700_000_000_000,
      direction: 'outgoing',
      sendState: 'queued',
      edited: true,
      quote: {
        sourceId: 'quote-1',
        excerpt: 'цитата',
      },
    })
    expect(state.localIdByProviderId['event-1']).toBeUndefined()
    expect(state.localIdByProviderId['event-2']).toBeUndefined()
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Ещё',
      lastActivityAt: 1_700_000_000_000,
      unseenIncomingIds: [],
    })
    expect(selectChatIds(useChatStore.getState())).toEqual(order)
  })

  it('keeps an incoming edit off the unread indicator', () => {
    updateMessage('local-1', { direction: 'incoming', sendState: null })
    noteUnseenIncoming('10000000', 'other-incoming')

    applyNotification(
      editWebhook('incomingMessageReceived', 'event-in', 'От собеседника'),
    )

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
    ])
    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      text: 'От собеседника',
      direction: 'incoming',
      sendState: null,
    })
    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual(['other-incoming'])
  })

  it('stores an edit that arrives before the original and applies it when the id appears', () => {
    applyNotification(
      editWebhook(
        'outgoingAPIMessageReceived',
        'event-1',
        'Раньше',
        'future-1',
      ),
    )

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
    ])
    expect(useMessageStore.getState().messagesById['local-1']?.text).toBe(
      'hello',
    )
    addMessage({
      localId: 'local-future',
      providerId: null,
      chatId: '10000000',
      text: 'Было',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 5_000,
      sentAt: 5_000,
      sendState: 'sending',
      errorText: null,
    })
    expect(useMessageStore.getState().messagesById['local-future']?.text).toBe(
      'Было',
    )

    updateMessage('local-future', {
      providerId: 'future-1',
      sendState: 'queued',
    })

    expect(
      useMessageStore.getState().messagesById['local-future'],
    ).toMatchObject({
      providerId: 'future-1',
      text: 'Раньше',
      sentAt: 5_000,
      edited: true,
    })
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
      'local-future',
    ])
  })

  it('does not let an older edit event replace a newer pending edit', () => {
    applyNotification(
      editWebhook(
        'outgoingAPIMessageReceived',
        'event-new',
        'Новее',
        'future-2',
      ),
    )
    applyMessageEdit({
      chatId: '10000000',
      originalId: 'future-2',
      eventId: 'event-old',
      text: 'Старше',
      eventAt: 1_000,
    })
    addMessage({
      localId: 'local-future-2',
      providerId: 'future-2',
      chatId: '10000000',
      text: 'Было',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 5_000,
      sentAt: 5_000,
      sendState: 'sent',
      errorText: null,
    })

    expect(
      useMessageStore.getState().messagesById['local-future-2']?.text,
    ).toBe('Новее')
  })

  it('removes a previously stored edit event without deleting a real unsupported message', () => {
    addMessage({
      localId: 'local-stub',
      providerId: 'event-1',
      chatId: '10000000',
      text: unsupportedMessageText,
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_700_000_009_000,
      sentAt: 1_700_000_009_000,
      sendState: 'sent',
      errorText: null,
    })
    addMessage({
      localId: 'local-own',
      providerId: 'own-text',
      chatId: '10000000',
      text: unsupportedMessageText,
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 4_000,
      sentAt: 4_000,
      sendState: 'sent',
      errorText: null,
    })
    recordChatActivity('10000000', {
      preview: unsupportedMessageText,
      at: 1_700_000_009_000,
    })

    applyNotification(
      editWebhook('outgoingAPIMessageReceived', 'event-1', 'Стало'),
    )

    const state = useMessageStore.getState()
    expect(state.messagesById['local-stub']).toBeUndefined()
    expect(state.messagesById['local-own']?.text).toBe(unsupportedMessageText)
    expect(state.messagesById['local-1']?.text).toBe('Стало')
    expect(state.messageIdsByChatId['10000000']).toEqual([
      'local-1',
      'local-own',
    ])
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Стало',
      lastActivityAt: 1_700_000_000_000,
    })
  })

  it('does not treat the chat contact as the author of a forwarded incoming message', () => {
    upsertChat({
      chatId: '10000000',
      phoneNumber: null,
      name: 'Анна',
      username: null,
    })
    applyNotification(
      {
        typeWebhook: 'incomingMessageReceived',
        timestamp: 1_755_591_520,
        idMessage: 'in-fwd',
        senderData: { chatId: '10000000' },
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: {
            textMessage: 'Чужое',
            isForwarded: true,
            forwardingScore: 1,
          },
        },
      },
      { createId: () => 'local-fwd-in' },
    )
    applyNotification(
      {
        typeWebhook: 'incomingMessageReceived',
        timestamp: 1_755_591_520,
        idMessage: 'in-fwd',
        senderData: { chatId: '10000000' },
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: {
            textMessage: 'Чужое',
            isForwarded: true,
            forwardingScore: 1,
          },
        },
      },
      { createId: () => 'local-fwd-in-2' },
    )

    expect(
      useMessageStore.getState().messagesById['local-fwd-in'],
    ).toMatchObject({
      forwarded: true,
      forwardingScore: 1,
      originName: null,
      text: 'Чужое',
    })
    expect(
      useMessageStore.getState().messagesById['local-fwd-in-2'],
    ).toBeUndefined()
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
      'local-fwd-in',
    ])
  })

  it('does not attach a forwarded outgoing copy to a pending send with the same text', () => {
    addMessage({
      localId: 'local-pending',
      providerId: null,
      chatId: '10000000',
      text: 'hello',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_700_000_000_100,
      sentAt: 1_700_000_000_100,
      sendState: 'sending',
      errorText: null,
    })
    applyNotification(
      {
        typeWebhook: 'outgoingAPIMessageReceived',
        timestamp: 1_755_591_521,
        idMessage: 'provider-fwd',
        senderData: {
          chatId: '10000000',
          chatName: 'Избранное',
          chatType: 'user',
          senderPhoneNumber: 0,
        },
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: {
            textMessage: 'hello',
            isForwarded: true,
            forwardingScore: 2,
          },
        },
      },
      { createId: () => 'local-fwd-out' },
    )

    expect(
      useMessageStore.getState().messagesById['local-pending']?.providerId,
    ).toBe(null)
    expect(
      useMessageStore.getState().messagesById['local-fwd-out'],
    ).toMatchObject({
      forwarded: true,
      originName: null,
      text: 'hello',
    })
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'hello',
      previewForwarded: true,
    })

    applyNotification(
      editWebhook(
        'outgoingAPIMessageReceived',
        'event-fwd',
        'hello!',
        'provider-fwd',
      ),
    )

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'hello!',
      previewForwarded: true,
    })

    applyNotification({
      typeWebhook: 'incomingMessageReceived',
      timestamp: 1_755_591_530,
      idMessage: 'incoming-plain',
      senderData: { chatId: '10000000' },
      messageData: {
        typeMessage: 'textMessage',
        textMessageData: { textMessage: 'Дальше' },
      },
    })

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Дальше',
      previewForwarded: false,
    })
  })

  it('deletes by stanzaId, keeps a pending deletion, and ignores an unknown status', () => {
    recordChatActivity('10000000', {
      preview: 'hello',
      at: 1_700_000_000_000,
    })
    const order = selectChatIds(useChatStore.getState())

    applyNotification({
      typeWebhook: 'outgoingMessageStatus',
      timestamp: 1_700_000_020,
      idMessage: 'provider-1',
      chatId: '10000000',
      status: 'mystery',
    })
    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      text: 'hello',
      sendState: 'queued',
    })

    applyNotification({
      typeWebhook: 'outgoingMessageReceived',
      timestamp: 1_700_000_050,
      idMessage: 'event-delete',
      senderData: { chatId: '10000000' },
      messageData: {
        typeMessage: 'deletedMessage',
        deletedMessageData: { stanzaId: 'provider-1' },
      },
    })
    applyNotification({
      typeWebhook: 'outgoingMessageReceived',
      timestamp: 1_700_000_050,
      idMessage: 'event-delete',
      senderData: { chatId: '10000000' },
      messageData: {
        typeMessage: 'deletedMessage',
        deletedMessageData: { stanzaId: 'provider-1' },
      },
    })

    expect(useMessageStore.getState().messagesById['local-1']).toBeUndefined()
    expect(
      useMessageStore.getState().localIdByProviderId['event-delete'],
    ).toBeUndefined()
    mergeChatHistory(
      '10000000',
      [
        {
          providerId: 'provider-1',
          chatId: '10000000',
          text: 'Обычное',
          stickerUrl: null,
          stickerMimeType: null,
          direction: 'outgoing',
          createdAt: 1_700_000_000_000,
          sentAt: 1_700_000_000_000,
          sendState: 'sent',
        },
      ],
      () => 'restored',
    )
    expect(useMessageStore.getState().localIdByProviderId['provider-1']).toBe(
      undefined,
    )
    expect(useChatStore.getState().chatsById['10000000']?.preview).toBeNull()
    expect(selectChatIds(useChatStore.getState())).toEqual(order)

    applyNotification({
      typeWebhook: 'incomingMessageReceived',
      timestamp: 1_700_000_060,
      idMessage: 'event-early',
      senderData: { chatId: '10000000' },
      messageData: {
        typeMessage: 'deletedMessage',
        deletedMessageData: { stanzaId: 'provider-later' },
      },
    })
    mergeChatHistory(
      '10000000',
      [
        {
          providerId: 'provider-later',
          chatId: '10000000',
          text: 'позже',
          stickerUrl: null,
          stickerMimeType: null,
          direction: 'incoming',
          createdAt: 1_700_000_010_000,
          sentAt: 1_700_000_010_000,
          sendState: null,
        },
      ],
      () => 'later',
    )
    expect(
      useMessageStore.getState().localIdByProviderId['provider-later'],
    ).toBeUndefined()
    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual([])
  })

  it('stores a reaction on the original and does not raise the chat', () => {
    recordChatActivity('10000000', {
      preview: 'hello',
      at: 1_700_000_000_000,
    })
    noteUnseenIncoming('10000000', 'provider-1')
    const order = selectChatIds(useChatStore.getState())

    applyNotification({
      typeWebhook: 'incomingMessageReceived',
      timestamp: 1_700_000_050,
      idMessage: 'event-reaction',
      senderData: { chatId: '10000000' },
      messageData: {
        typeMessage: 'reactionMessage',
        extendedTextMessageData: { text: '👍' },
        targetId: 'provider-1',
      },
    })
    applyNotification({
      typeWebhook: 'incomingMessageReceived',
      timestamp: 1_700_000_040,
      idMessage: 'event-reaction',
      senderData: { chatId: '10000000' },
      messageData: {
        typeMessage: 'reactionMessage',
        extendedTextMessageData: { text: '👎' },
        targetId: 'provider-1',
      },
    })

    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
    ])
    expect(
      useMessageStore.getState().messagesById['local-1']?.reactions,
    ).toEqual([
      { sourceId: 'event-reaction', emoji: '👍', eventAt: 1_700_000_050_000 },
    ])
    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'hello',
      lastActivityAt: 1_700_000_000_000,
      unseenIncomingIds: ['provider-1'],
    })
    expect(selectChatIds(useChatStore.getState())).toEqual(order)
  })
})

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

function officialText(
  idMessage: string,
  text: string,
  chatId = '10000000',
  typeWebhook:
    | 'outgoingMessageReceived'
    | 'outgoingAPIMessageReceived' = 'outgoingMessageReceived',
): MaxNotification {
  return {
    typeWebhook,
    timestamp: 1_755_591_519,
    idMessage,
    senderData: {
      chatId,
      chatName: chatId === '30000000' ? 'Анна' : 'Избранное',
      chatType: chatId.startsWith('-') ? 'group' : 'user',
      senderPhoneNumber: chatId === '30000000' ? 79876543210 : 0,
    },
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: text },
    },
  }
}

function editWebhook(
  typeWebhook:
    | 'incomingMessageReceived'
    | 'outgoingMessageReceived'
    | 'outgoingAPIMessageReceived',
  idMessage: string,
  text: string,
  stanzaId = 'provider-1',
): MaxNotification {
  return {
    typeWebhook,
    timestamp: 1_700_000_009,
    idMessage,
    senderData: { chatId: '10000000' },
    messageData: {
      typeMessage: 'editedMessage',
      editedMessageData: {
        textMessage: text,
        stanzaId,
      },
    },
  }
}

function incomingText(
  idMessage: string,
  text: string,
  chatId = '10000000',
): MaxNotification {
  return {
    typeWebhook: 'incomingMessageReceived',
    timestamp: 1_755_591_519,
    idMessage,
    senderData: { chatId },
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: text },
    },
  }
}
