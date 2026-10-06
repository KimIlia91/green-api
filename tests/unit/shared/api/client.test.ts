import { beforeEach, describe, expect, it, vi } from 'vitest'

import { requestTimeouts } from '@/shared/config/index.ts'

import { createGreenApiClient } from '@/shared/api/client.ts'
import { GreenApiError } from '@/shared/api/errors.ts'
import { resetRequestRate } from '@/shared/api/request-rate.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('createGreenApiClient', () => {
  beforeEach(() => {
    resetRequestRate()
  })

  it('rejects an unapproved host before sending credentials', () => {
    const fetchImpl = vi.fn<typeof fetch>()
    expect(() =>
      createGreenApiClient(
        {
          ...connection,
          apiUrl: 'https://evil.example/waInstance1/getStateInstance/abc123',
        },
        { fetchImpl },
      ),
    ).toThrow(GreenApiError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reads GetStateInstance', async () => {
    const fetchImpl = mockJson({ stateInstance: 'authorized' })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(client.getStateInstance()).resolves.toEqual({
      stateInstance: 'authorized',
    })

    const [input, init] = fetchImpl.mock.calls[0] ?? []
    expect(requestTarget(input)).toBe(
      'https://3100.api.green-api.com/waInstance3100000001/getStateInstance/abc123',
    )
    expect(init?.method).toBe('GET')
  })

  it('sends an international CheckAccount number as digits', async () => {
    const fetchImpl = mockJson({
      exist: false,
      chatId: '',
      fromCache: false,
    })
    const client = createGreenApiClient(connection, { fetchImpl })

    await client.checkAccount({ phoneNumber: 996700123456 })

    const [, init] = fetchImpl.mock.calls[0] ?? []
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ phoneNumber: 996700123456 }))
  })

  it('does not send a CheckAccount number outside 7 to 15 digits', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.checkAccount({ phoneNumber: 123456 }),
    ).rejects.toMatchObject({ kind: 'invalid-request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns a negative CheckAccount result', async () => {
    const fetchImpl = mockJson({
      status: false,
      reason: 'instance is starting or not authorized',
    })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.checkAccount({ phoneNumber: 79991234567 }),
    ).resolves.toEqual({
      status: false,
      reason: 'instance is starting or not authorized',
    })
  })

  it('reads the MAX GetContactInfo fields', async () => {
    const fetchImpl = mockJson({
      chatId: '10000000',
      avatar: '',
      name: '',
      contactName: 'Анна',
      chatType: 'user',
      lastSeen: null,
      phoneNumber: 79991234567,
      phoneNumberTimestamp: 0,
    })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.getContactInfo({ chatId: '10000000' }),
    ).resolves.toEqual({
      chatId: '10000000',
      name: '',
      contactName: 'Анна',
      phoneNumber: 79991234567,
    })

    const [input, init] = fetchImpl.mock.calls[0] ?? []
    expect(requestTarget(input)).toContain('/getContactInfo/')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ chatId: '10000000' }))
  })

  it('rejects GetContactInfo when a required field is missing', async () => {
    const fetchImpl = mockJson({ chatId: '10000000', name: 'Анна' })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.getContactInfo({ chatId: '10000000' }),
    ).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('returns SendMessage idMessage without treating it as delivery', async () => {
    const fetchImpl = mockJson({ idMessage: '1763115112345' })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.sendMessage({ chatId: '10000000', message: 'Привет' }),
    ).resolves.toEqual({ idMessage: '1763115112345' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('posts EditMessage with the chat, the provider id, and the new text', async () => {
    const fetchImpl = mockJson({ idMessage: '1763115112345' })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.editMessage({
        chatId: '10000000',
        idMessage: '1763115112345',
        message: 'Новый текст',
      }),
    ).resolves.toEqual({ idMessage: '1763115112345' })
    const [input, init] = fetchImpl.mock.calls[0] ?? []
    expect(requestTarget(input)).toContain('/editMessage/')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(
      JSON.stringify({
        chatId: '10000000',
        idMessage: '1763115112345',
        message: 'Новый текст',
      }),
    )
  })

  it('treats an empty ReceiveNotification body as no notification', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 200 }))
    const client = createGreenApiClient(connection, {
      fetchImpl,
      timeouts: requestTimeouts,
    })

    await expect(client.receiveNotification()).resolves.toBeNull()

    const [input, init] = fetchImpl.mock.calls[0] ?? []
    const url = new URL(requestTarget(input))
    expect(url.searchParams.get('receiveTimeout')).toBe('20')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('treats JSON null from ReceiveNotification as no notification', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('null', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(client.receiveNotification()).resolves.toBeNull()
  })

  it('returns DeleteNotification result false', async () => {
    const fetchImpl = mockJson({ result: false, reason: 'already deleted' })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(client.deleteNotification(1234567)).resolves.toEqual({
      result: false,
      reason: 'already deleted',
    })

    const [input, init] = fetchImpl.mock.calls[0] ?? []
    expect(requestTarget(input)).toContain('/deleteNotification/abc123/1234567')
    expect(init?.method).toBe('DELETE')
  })

  it('parses an incoming text notification', async () => {
    const fetchImpl = mockJson({
      receiptId: 10,
      body: {
        typeWebhook: 'incomingMessageReceived',
        timestamp: 1763115112,
        idMessage: '1763115112345',
        senderData: { chatId: '10000000' },
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: { textMessage: 'Привет' },
        },
      },
    })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(client.receiveNotification()).resolves.toMatchObject({
      receiptId: 10,
      body: {
        typeWebhook: 'incomingMessageReceived',
        idMessage: '1763115112345',
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: { textMessage: 'Привет' },
        },
      },
    })
  })

  it('parses an incoming text notification that contains a URL', async () => {
    const fetchImpl = mockJson({
      receiptId: 11,
      body: {
        typeWebhook: 'incomingMessageReceived',
        timestamp: 1763115112,
        idMessage: '1763115112346',
        senderData: { chatId: '10000000' },
        messageData: {
          typeMessage: 'extendedTextMessage',
          extendedTextMessageData: {
            text: 'Документация https://green-api.com/v3/docs/',
            description: '',
            title: 'GREEN-API',
          },
        },
      },
    })
    const client = createGreenApiClient(connection, { fetchImpl })
    const notification = await client.receiveNotification()

    expect(notification?.body).toMatchObject({
      messageData: {
        typeMessage: 'extendedTextMessage',
        extendedTextMessageData: {
          text: 'Документация https://green-api.com/v3/docs/',
        },
      },
    })
  })

  it('parses an outgoing message sent from the phone or web client', async () => {
    const fetchImpl = mockJson({
      receiptId: 14,
      body: {
        typeWebhook: 'outgoingMessageReceived',
        timestamp: 1763115112,
        idMessage: '1763115112345',
        senderData: {
          chatId: '10000000',
          chatName: 'Избранное',
          chatType: 'user',
          sender: '10000000',
          senderPhoneNumber: 0,
        },
        messageData: {
          typeMessage: 'extendedTextMessage',
          extendedTextMessageData: {
            text: 'Ссылка https://green-api.com/v3/docs/',
          },
        },
      },
    })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(client.receiveNotification()).resolves.toMatchObject({
      receiptId: 14,
      body: {
        typeWebhook: 'outgoingMessageReceived',
        idMessage: '1763115112345',
        senderData: {
          chatId: '10000000',
          chatName: 'Избранное',
          chatType: 'user',
          senderPhoneNumber: null,
        },
        messageData: {
          typeMessage: 'extendedTextMessage',
          extendedTextMessageData: {
            text: 'Ссылка https://green-api.com/v3/docs/',
          },
        },
      },
    })
  })

  it('parses an outgoing status that arrives on its own', async () => {
    const fetchImpl = mockJson({
      receiptId: 12,
      body: {
        typeWebhook: 'outgoingMessageStatus',
        timestamp: 1755591519,
        idMessage: '115054445839974415',
        chatId: '10000000',
        status: 'delivered',
      },
    })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(client.receiveNotification()).resolves.toMatchObject({
      receiptId: 12,
      body: {
        typeWebhook: 'outgoingMessageStatus',
        idMessage: '115054445839974415',
        status: 'delivered',
      },
    })
  })

  it('keeps an unknown notification type', async () => {
    const fetchImpl = mockJson({
      receiptId: 13,
      body: { typeWebhook: 'stateInstanceChanged' },
    })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(client.receiveNotification()).resolves.toEqual({
      receiptId: 13,
      body: { recognized: false, typeWebhook: 'stateInstanceChanged' },
    })
  })

  it('rejects a successful response that misses required fields', async () => {
    const fetchImpl = mockJson({ unexpected: true })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(client.getStateInstance()).rejects.toMatchObject({
      kind: 'invalid-response',
    })
  })

  it('does not retry SendMessage after an HTTP error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Validation failed' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.sendMessage({ chatId: '10000000', message: 'Привет' }),
    ).rejects.toMatchObject({ kind: 'http', status: 400 })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('reads GetChats without inventing message fields', async () => {
    const fetchImpl = mockJson([
      {
        chatId: '10000000',
        name: 'Анна',
        type: 'user',
        phoneNumber: 79991234567,
      },
      {
        chatId: '10000001',
        name: '',
        type: 'user',
        phoneNumber: 0,
      },
    ])
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(client.getChats()).resolves.toEqual([
      {
        chatId: '10000000',
        name: 'Анна',
        type: 'user',
        phoneNumber: 79991234567,
      },
      {
        chatId: '10000001',
        name: '',
        type: 'user',
        phoneNumber: 0,
      },
    ])
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('GET')
  })

  it('requests GetChatHistory with chatId and count only', async () => {
    const fetchImpl = mockJson([
      {
        type: 'outgoing',
        idMessage: 'provider-1',
        timestamp: 1_755_000_000,
        typeMessage: 'textMessage',
        chatId: '10000000',
        textMessage: 'Привет',
        statusMessage: 'sent',
        downloadUrl: 'https://files.example/secret',
      },
      {
        type: 'incoming',
        idMessage: 'provider-2',
        timestamp: 1_755_000_001,
        typeMessage: 'imageMessage',
        chatId: '10000000',
        downloadUrl: 'https://files.example/photo',
      },
    ])
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.getChatHistory({ chatId: '10000000', count: 100 }),
    ).resolves.toEqual([
      {
        type: 'outgoing',
        idMessage: 'provider-1',
        timestamp: 1_755_000_000,
        chatId: '10000000',
        typeMessage: 'textMessage',
        text: 'Привет',
        statusMessage: 'sent',
        stickerUrl: null,
        stickerMimeType: null,
        quote: null,
        isEdited: false,
        editedMessageId: null,
        editEvent: null,
        reaction: null,
        deletion: null,
        deleted: false,
        deletedMessageId: null,
        forwarded: false,
        forwardingScore: null,
      },
      {
        type: 'incoming',
        idMessage: 'provider-2',
        timestamp: 1_755_000_001,
        chatId: '10000000',
        typeMessage: 'imageMessage',
        text: null,
        statusMessage: null,
        stickerUrl: null,
        stickerMimeType: null,
        quote: null,
        isEdited: false,
        editedMessageId: null,
        editEvent: null,
        reaction: null,
        deletion: null,
        deleted: false,
        deletedMessageId: null,
        forwarded: false,
        forwardingScore: null,
      },
    ])

    const init = fetchImpl.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    if (typeof init?.body === 'string') {
      expect(JSON.parse(init.body)).toEqual({
        chatId: '10000000',
        count: 100,
      })
    }
  })

  it('keeps an https sticker file and ignores a still jpeg substitute', async () => {
    const fetchImpl = mockJson([
      {
        type: 'incoming',
        idMessage: 'sticker-1',
        timestamp: 1_755_000_000,
        typeMessage: 'stickerMessage',
        chatId: '10000000',
        downloadUrl: 'https://media.example/sticker.png',
        downloadUrlJpeg: 'https://media.example/still.jpg',
        mimeType: 'image/png',
        isAnimated: true,
        caption: '  ',
      },
      {
        type: 'outgoing',
        idMessage: 'sticker-2',
        timestamp: 1_755_000_001,
        typeMessage: 'stickerMessage',
        chatId: '10000000',
        downloadUrl: 'http://media.example/sticker.png',
        downloadUrlJpeg: 'https://media.example/still.jpg',
        caption: 'подпись',
      },
    ])
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.getChatHistory({ chatId: '10000000', count: 100 }),
    ).resolves.toEqual([
      {
        type: 'incoming',
        idMessage: 'sticker-1',
        timestamp: 1_755_000_000,
        chatId: '10000000',
        typeMessage: 'stickerMessage',
        text: null,
        statusMessage: null,
        stickerUrl: 'https://media.example/sticker.png',
        stickerMimeType: 'image/png',
        quote: null,
        isEdited: false,
        editedMessageId: null,
        editEvent: null,
        reaction: null,
        deletion: null,
        deleted: false,
        deletedMessageId: null,
        forwarded: false,
        forwardingScore: null,
      },
      {
        type: 'outgoing',
        idMessage: 'sticker-2',
        timestamp: 1_755_000_001,
        chatId: '10000000',
        typeMessage: 'stickerMessage',
        text: null,
        statusMessage: null,
        stickerUrl: null,
        stickerMimeType: null,
        quote: null,
        isEdited: false,
        editedMessageId: null,
        editEvent: null,
        reaction: null,
        deletion: null,
        deleted: false,
        deletedMessageId: null,
        forwarded: false,
        forwardingScore: null,
      },
    ])
  })

  it('keeps a sticker picture when mimeType is absent and does not invent one from an empty downloadUrl', async () => {
    const fetchImpl = mockJson([
      {
        type: 'outgoing',
        idMessage: 'sticker-no-mime',
        timestamp: 1_755_000_000,
        typeMessage: 'stickerMessage',
        chatId: '10000000',
        downloadUrl: 'https://media.example/sticker.png',
        isAnimated: false,
      },
      {
        type: 'outgoing',
        idMessage: 'sticker-empty',
        timestamp: 1_755_000_001,
        typeMessage: 'stickerMessage',
        chatId: '10000000',
        downloadUrl: '',
        jpegThumbnail: '',
        mimeType: 'image/png',
        isAnimated: true,
        caption: '',
      },
    ])
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.getChatHistory({ chatId: '10000000', count: 100 }),
    ).resolves.toMatchObject([
      {
        idMessage: 'sticker-no-mime',
        stickerUrl: 'https://media.example/sticker.png',
        stickerMimeType: null,
      },
      {
        idMessage: 'sticker-empty',
        stickerUrl: null,
        stickerMimeType: null,
        text: null,
      },
    ])
  })

  it('keeps a forwarded sticker from history and from a notification', async () => {
    const history = mockJson([
      {
        type: 'outgoing',
        idMessage: 'sticker-forward',
        timestamp: 1_755_000_000,
        typeMessage: 'stickerMessage',
        chatId: '10000000',
        downloadUrl: 'https://media.example/sticker.webp',
        mimeType: 'image/webp',
        isForwarded: true,
        forwardingScore: 1,
        statusMessage: 'delivered',
      },
    ])
    const historyClient = createGreenApiClient(connection, {
      fetchImpl: history,
    })

    await expect(
      historyClient.getChatHistory({ chatId: '10000000', count: 1 }),
    ).resolves.toMatchObject([
      {
        idMessage: 'sticker-forward',
        stickerUrl: 'https://media.example/sticker.webp',
        forwarded: true,
        forwardingScore: 1,
      },
    ])

    const notification = mockJson({
      receiptId: 21,
      body: {
        typeWebhook: 'outgoingMessageReceived',
        timestamp: 1_755_000_000,
        idMessage: 'sticker-forward',
        senderData: { chatId: '10000000', sender: '70000000001' },
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
    })
    const notificationClient = createGreenApiClient(connection, {
      fetchImpl: notification,
    })

    await expect(
      notificationClient.receiveNotification(),
    ).resolves.toMatchObject({
      body: {
        messageData: {
          typeMessage: 'stickerMessage',
          fileMessageData: {
            isForwarded: true,
            forwardingScore: 1,
          },
        },
      },
    })
  })

  it('parses an incoming sticker notification', async () => {
    const fetchImpl = mockJson({
      receiptId: 13,
      body: {
        typeWebhook: 'incomingMessageReceived',
        timestamp: 1763115112,
        idMessage: 'sticker-live',
        senderData: { chatId: '10000000' },
        messageData: {
          typeMessage: 'stickerMessage',
          fileMessageData: {
            downloadUrl: 'https://media.example/sticker.webp',
            mimeType: 'image/webp',
            isAnimated: true,
            caption: '',
          },
        },
      },
    })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(client.receiveNotification()).resolves.toMatchObject({
      body: {
        messageData: {
          typeMessage: 'stickerMessage',
          fileMessageData: {
            downloadUrl: 'https://media.example/sticker.webp',
            mimeType: 'image/webp',
            caption: '',
          },
        },
      },
    })
  })

  it('sends quotedMessageId only when a reply id is present', async () => {
    const plain = mockJson({ idMessage: '1763115112345' })
    const plainClient = createGreenApiClient(connection, { fetchImpl: plain })
    await plainClient.sendMessage({ chatId: '10000000', message: 'Привет' })
    const plainBody = plain.mock.calls[0]?.[1]?.body
    expect(typeof plainBody).toBe('string')
    if (typeof plainBody === 'string') {
      expect(JSON.parse(plainBody)).toEqual({
        chatId: '10000000',
        message: 'Привет',
      })
    }

    const quoted = mockJson({ idMessage: '1763115112346' })
    const quotedClient = createGreenApiClient(connection, {
      fetchImpl: quoted,
    })
    await quotedClient.sendMessage({
      chatId: '10000000',
      message: 'ответ',
      quotedMessageId: '116413118178426437',
    })
    const quotedBody = quoted.mock.calls[0]?.[1]?.body
    expect(typeof quotedBody).toBe('string')
    if (typeof quotedBody === 'string') {
      expect(JSON.parse(quotedBody)).toEqual({
        chatId: '10000000',
        message: 'ответ',
        quotedMessageId: '116413118178426437',
      })
    }
  })

  it('reads documented MAX quote fields from history and notifications', async () => {
    const history = mockJson([
      {
        type: 'incoming',
        idMessage: '1763115112345',
        timestamp: 1_763_115_112,
        typeMessage: 'quotedMessage',
        chatId: '10000000',
        extendedTextMessageData: {
          text: 'Цитируем это',
          stanzaId: '116413118178426437',
          participant: '10000000',
        },
        quotedMessage: {
          stanzaId: '116413118178426437',
          participant: '10000000',
          typeMessage: 'textMessage',
          textMessage: 'исходный текст',
        },
      },
      {
        type: 'outgoing',
        idMessage: '1763115112346',
        timestamp: 1_763_115_113,
        typeMessage: 'quotedMessage',
        chatId: '10000000',
        extendedTextMessageData: {
          text: 'ответ на стикер',
          stanzaId: '116413118178426438',
          participant: '10000000',
        },
        quotedMessage: {
          stanzaId: '116413118178426438',
          participant: '10000000',
          typeMessage: 'stickerMessage',
        },
      },
    ])
    const historyClient = createGreenApiClient(connection, {
      fetchImpl: history,
    })
    await expect(
      historyClient.getChatHistory({ chatId: '10000000', count: 2 }),
    ).resolves.toMatchObject([
      {
        text: 'Цитируем это',
        quote: {
          sourceId: '116413118178426437',
          participant: '10000000',
          typeMessage: 'textMessage',
          excerpt: 'исходный текст',
        },
      },
      {
        text: 'ответ на стикер',
        quote: {
          sourceId: '116413118178426438',
          typeMessage: 'stickerMessage',
          excerpt: null,
        },
      },
    ])

    const incoming = mockJson({
      receiptId: 4,
      body: {
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
        },
      },
    })
    const incomingClient = createGreenApiClient(connection, {
      fetchImpl: incoming,
    })
    await expect(incomingClient.receiveNotification()).resolves.toMatchObject({
      body: {
        typeWebhook: 'incomingMessageReceived',
        messageData: {
          typeMessage: 'quotedMessage',
          extendedTextMessageData: { text: 'Цитируем это' },
          quote: {
            sourceId: '116413118178426437',
            participant: '10000000',
            excerpt: null,
          },
        },
      },
    })

    const apiSent = mockJson({
      receiptId: 5,
      body: {
        typeWebhook: 'outgoingAPIMessageReceived',
        timestamp: 1_588_091_580,
        idMessage: '1763115112345',
        senderData: {
          chatId: '10000000',
          chatName: 'Анна',
          chatType: 'user',
          senderPhoneNumber: 79876543210,
        },
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: { textMessage: 'ответ' },
          quotedMessage: {
            stanzaId: '116413118178426437',
            participant: '10000000',
          },
        },
      },
    })
    const apiClient = createGreenApiClient(connection, { fetchImpl: apiSent })
    await expect(apiClient.receiveNotification()).resolves.toMatchObject({
      body: {
        typeWebhook: 'outgoingAPIMessageReceived',
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: { textMessage: 'ответ' },
          quote: {
            sourceId: '116413118178426437',
            participant: '10000000',
            excerpt: null,
          },
        },
      },
    })
  })

  it('parses an edited message webhook without treating it as a new text message', async () => {
    const fetchImpl = mockJson({
      receiptId: 21,
      body: {
        typeWebhook: 'outgoingAPIMessageReceived',
        timestamp: 1_700_000_009,
        idMessage: 'event-1',
        senderData: { chatId: '10000000', chatType: 'user' },
        messageData: {
          typeMessage: 'editedMessage',
          editedMessageData: {
            textMessage: 'Стало',
            stanzaId: 'provider-1',
          },
        },
      },
    })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(client.receiveNotification()).resolves.toMatchObject({
      body: {
        typeWebhook: 'outgoingAPIMessageReceived',
        idMessage: 'event-1',
        messageData: {
          typeMessage: 'editedMessage',
          editedMessageData: {
            textMessage: 'Стало',
            stanzaId: 'provider-1',
          },
        },
      },
    })
  })

  it('reads a history edit from documented fields and from an edit event row', async () => {
    const fetchImpl = mockJson([
      {
        type: 'outgoing',
        idMessage: 'provider-1',
        timestamp: 1_700_000_000,
        typeMessage: 'textMessage',
        chatId: '10000000',
        textMessage: 'Стало',
        statusMessage: 'read',
        isEdited: true,
        editedMessageId: 'provider-1',
      },
      {
        type: 'incoming',
        idMessage: 'event-1',
        timestamp: 1_700_000_020,
        typeMessage: 'editedMessage',
        chatId: '10000000',
        editedMessageData: {
          textMessage: 'Стало',
          stanzaId: 'provider-1',
        },
      },
      {
        type: 'outgoing',
        idMessage: 'event-2',
        timestamp: 1_700_000_030,
        typeMessage: 'editedMessage',
        chatId: '10000000',
        textMessage: 'Иначе',
        editedMessageId: 'provider-2',
      },
      {
        type: 'outgoing',
        idMessage: 'event-3',
        timestamp: 1_700_000_040,
        typeMessage: 'editedMessage',
        chatId: '10000000',
      },
    ])
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.getChatHistory({ chatId: '10000000', count: 4 }),
    ).resolves.toMatchObject([
      {
        idMessage: 'provider-1',
        typeMessage: 'textMessage',
        text: 'Стало',
        isEdited: true,
        editedMessageId: 'provider-1',
        editEvent: null,
        reaction: null,
        deletion: null,
        deleted: false,
        deletedMessageId: null,
        forwarded: false,
        forwardingScore: null,
      },
      {
        idMessage: 'event-1',
        typeMessage: 'editedMessage',
        editEvent: { originalId: 'provider-1', text: 'Стало' },
      },
      {
        idMessage: 'event-2',
        typeMessage: 'editedMessage',
        editEvent: { originalId: 'provider-2', text: 'Иначе' },
      },
      {
        idMessage: 'event-3',
        typeMessage: 'editedMessage',
        editEvent: { originalId: null, text: null },
      },
    ])
  })

  it('reads an outgoing forwarded notification and a non-text edit row', async () => {
    const forwarded = mockJson({
      receiptId: 31,
      body: {
        typeWebhook: 'outgoingAPIMessageReceived',
        timestamp: 1_700_000_040,
        idMessage: 'provider-fwd',
        senderData: { chatId: '10000000', chatType: 'user' },
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: {
            textMessage: 'Привет',
            isForwarded: true,
            forwardingScore: 1,
          },
        },
      },
    })
    const forwardClient = createGreenApiClient(connection, {
      fetchImpl: forwarded,
    })
    await expect(forwardClient.receiveNotification()).resolves.toMatchObject({
      body: {
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: {
            textMessage: 'Привет',
            isForwarded: true,
            forwardingScore: 1,
          },
        },
      },
    })

    const history = mockJson([
      {
        type: 'outgoing',
        idMessage: 'event-x',
        timestamp: 1_700_000_050,
        typeMessage: 'reactionMessage',
        chatId: '10000000',
        extendedTextMessageData: { text: '👍' },
        quotedMessage: {
          stanzaId: 'provider-1',
          participant: '10000000',
        },
        statusMessage: 'delivered',
      },
    ])
    const historyClient = createGreenApiClient(connection, {
      fetchImpl: history,
    })
    await expect(
      historyClient.getChatHistory({ chatId: '10000000', count: 1 }),
    ).resolves.toMatchObject([
      {
        idMessage: 'event-x',
        typeMessage: 'reactionMessage',
        editEvent: null,
        reaction: { targetId: 'provider-1', emoji: '👍' },
        deletion: null,
        deleted: false,
      },
    ])
  })

  it('reads a forwarded text row without inventing an author', async () => {
    const fetchImpl = mockJson([
      {
        type: 'incoming',
        idMessage: 'provider-1',
        timestamp: 1_700_000_000,
        typeMessage: 'textMessage',
        chatId: '10000000',
        textMessage: 'Привет',
        textMessageData: {
          textMessage: 'Другой текст',
          isForwarded: true,
          forwardingScore: 2,
        },
        senderName: 'Не автор',
      },
    ])
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.getChatHistory({ chatId: '10000000', count: 1 }),
    ).resolves.toMatchObject([
      {
        text: 'Привет',
        forwarded: true,
        forwardingScore: 2,
      },
    ])
  })

  it('keeps journal reactions and deletions out of message text', async () => {
    const fetchImpl = mockJson([
      {
        type: 'outgoing',
        idMessage: 'provider-text',
        timestamp: 1_700_000_000,
        typeMessage: 'textMessage',
        chatId: '10000000',
        textMessage: 'Этот тип сообщения не поддерживается',
        statusMessage: 'mystery',
      },
      {
        type: 'outgoing',
        idMessage: 'event-reaction',
        timestamp: 1_700_000_010,
        typeMessage: 'reactionMessage',
        chatId: '10000000',
        extendedTextMessageData: { text: '👍' },
        quotedMessage: {
          stanzaId: 'provider-text',
          participant: '10000000',
        },
        statusMessage: 'delivered',
      },
      {
        type: 'outgoing',
        idMessage: 'provider-gone',
        timestamp: 1_700_000_020,
        typeMessage: 'textMessage',
        chatId: '10000000',
        textMessage: 'скрыто',
        isDeleted: true,
        deletedMessageId: 'provider-gone',
      },
      {
        type: 'incoming',
        idMessage: 'event-delete',
        timestamp: 1_700_000_030,
        typeMessage: 'deletedMessage',
        chatId: '10000000',
        deletedMessageData: { stanzaId: 'provider-other' },
      },
    ])
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.getChatHistory({ chatId: '10000000', count: 4 }),
    ).resolves.toMatchObject([
      {
        idMessage: 'provider-text',
        typeMessage: 'textMessage',
        text: 'Этот тип сообщения не поддерживается',
        statusMessage: 'mystery',
        reaction: null,
        deletion: null,
        deleted: false,
      },
      {
        idMessage: 'event-reaction',
        typeMessage: 'reactionMessage',
        reaction: { targetId: 'provider-text', emoji: '👍' },
        editEvent: null,
      },
      {
        idMessage: 'provider-gone',
        deleted: true,
        deletedMessageId: 'provider-gone',
      },
      {
        idMessage: 'event-delete',
        typeMessage: 'deletedMessage',
        deletion: { targetId: 'provider-other' },
        editEvent: null,
      },
    ])
  })

  it('reads a deleted notification by stanzaId and a reaction without a text body', async () => {
    const deleted = mockJson({
      receiptId: 41,
      body: {
        typeWebhook: 'outgoingMessageReceived',
        timestamp: 1_700_000_040,
        idMessage: 'event-delete',
        senderData: { chatId: '10000000', chatType: 'user' },
        messageData: {
          typeMessage: 'deletedMessage',
          deletedMessageData: { stanzaId: 'provider-1' },
        },
      },
    })
    const deletedClient = createGreenApiClient(connection, {
      fetchImpl: deleted,
    })
    await expect(deletedClient.receiveNotification()).resolves.toMatchObject({
      body: {
        idMessage: 'event-delete',
        messageData: {
          typeMessage: 'deletedMessage',
          deletedMessageData: { stanzaId: 'provider-1' },
        },
      },
    })

    const reaction = mockJson({
      receiptId: 42,
      body: {
        typeWebhook: 'incomingMessageReceived',
        timestamp: 1_700_000_050,
        idMessage: 'event-reaction',
        senderData: { chatId: '10000000' },
        messageData: {
          typeMessage: 'reactionMessage',
          extendedTextMessageData: { text: '👍' },
          quotedMessage: {
            stanzaId: 'provider-1',
            participant: '10000000',
          },
        },
      },
    })
    const reactionClient = createGreenApiClient(connection, {
      fetchImpl: reaction,
    })
    await expect(reactionClient.receiveNotification()).resolves.toMatchObject({
      body: {
        idMessage: 'event-reaction',
        messageData: {
          typeMessage: 'reactionMessage',
          targetId: 'provider-1',
          extendedTextMessageData: { text: '👍' },
        },
      },
    })
  })

  it('forwards by message id and returns the response ids separately', async () => {
    const fetchImpl = mockJson({ messages: ['queued-1'] })
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.forwardMessages({
        chatId: '20000000',
        chatIdFrom: '10000000',
        messages: ['provider-1', 'provider-2'],
      }),
    ).resolves.toEqual({ messages: ['queued-1'] })

    const [input, init] = fetchImpl.mock.calls[0] ?? []
    expect(requestTarget(input)).toContain('/forwardMessages/')
    expect(typeof init?.body).toBe('string')
    if (typeof init?.body === 'string') {
      expect(JSON.parse(init.body)).toEqual({
        chatId: '20000000',
        chatIdFrom: '10000000',
        messages: ['provider-1', 'provider-2'],
      })
    }
  })

  it('deletes one message and accepts an empty success body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 200 }))
    const client = createGreenApiClient(connection, { fetchImpl })

    await expect(
      client.deleteMessage({
        chatId: '10000000',
        idMessage: 'provider-1',
      }),
    ).resolves.toBeUndefined()

    const [input, init] = fetchImpl.mock.calls[0] ?? []
    expect(requestTarget(input)).toContain('/deleteMessage/')
    expect(typeof init?.body).toBe('string')
    if (typeof init?.body === 'string') {
      expect(JSON.parse(init.body)).toEqual({
        chatId: '10000000',
        idMessage: 'provider-1',
        onlySenderDelete: false,
      })
    }
  })

  it('marks one incoming message read and rejects a false flag', async () => {
    const fetchImpl = mockJson({ setRead: true })
    const client = createGreenApiClient(connection, { fetchImpl })
    const controller = new AbortController()

    await expect(
      client.readChat(
        { chatId: '10000000', idMessage: '115066794584856130' },
        { signal: controller.signal },
      ),
    ).resolves.toEqual({ setRead: true })

    const [input, init] = fetchImpl.mock.calls[0] ?? []
    expect(requestTarget(input)).toContain('/readChat/')
    expect(init?.method).toBe('POST')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.body).toBe(
      JSON.stringify({
        chatId: '10000000',
        idMessage: '115066794584856130',
      }),
    )

    const refused = createGreenApiClient(connection, {
      fetchImpl: mockJson({ setRead: false }),
    })
    await expect(
      refused.readChat({
        chatId: '10000000',
        idMessage: '115066794584856130',
      }),
    ).rejects.toMatchObject({ kind: 'invalid-response' })

    const skipped = vi.fn<typeof fetch>()
    const invalid = createGreenApiClient(connection, { fetchImpl: skipped })
    await expect(
      invalid.readChat({ chatId: '10000000', idMessage: ' ' }),
    ).rejects.toMatchObject({ kind: 'invalid-request' })
    expect(skipped).not.toHaveBeenCalled()

    const abortController = new AbortController()
    const hanging = vi.fn<typeof fetch>(
      () =>
        new Promise((_resolve, reject) => {
          abortController.signal.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        }),
    )
    const aborting = createGreenApiClient(connection, { fetchImpl: hanging })
    const pending = aborting.readChat(
      { chatId: '10000000', idMessage: '115066794584856130' },
      { signal: abortController.signal },
    )
    abortController.abort()
    await expect(pending).rejects.toMatchObject({ kind: 'abort' })
  })
})

function requestTarget(input: Parameters<typeof fetch>[0] | undefined): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.href
  }
  if (input instanceof Request) {
    return input.url
  }
  return ''
}

function mockJson(body: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}
