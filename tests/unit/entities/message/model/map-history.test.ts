import { describe, expect, it } from 'vitest'

import {
  messagePreview,
  unsupportedMessageText,
} from '@/entities/message/model/message-copy.ts'
import {
  mapHistoryEntry,
  unixSecondsToMillis,
} from '@/entities/message/model/map-history.ts'

describe('mapHistoryEntry', () => {
  it('turns seconds into milliseconds and keeps sent distinct from delivery', () => {
    expect(
      mapHistoryEntry({
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
      }),
    ).toEqual({
      providerId: 'provider-1',
      chatId: '10000000',
      text: 'Привет',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1_755_000_000_000,
      sentAt: 1_755_000_000_000,
      sendState: 'sent',
      quote: null,
    })
  })

  it('maps other message types to a neutral line without a delivery claim', () => {
    expect(
      mapHistoryEntry({
        type: 'incoming',
        idMessage: 'provider-2',
        timestamp: 1_755_000_000,
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
      }),
    ).toMatchObject({
      text: unsupportedMessageText,
      stickerUrl: null,
      sendState: null,
      createdAt: 1_755_000_000_000,
    })
  })

  it('keeps a sticker file address and its caption', () => {
    expect(
      mapHistoryEntry({
        type: 'incoming',
        idMessage: 'provider-3',
        timestamp: 1_755_000_000,
        chatId: '10000000',
        typeMessage: 'stickerMessage',
        text: 'подпись',
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
      }),
    ).toMatchObject({
      text: 'подпись',
      stickerUrl: 'https://media.example/sticker.png',
      stickerMimeType: 'image/png',
    })
  })

  it('uses the sticker label only when a file has no caption', () => {
    const draft = mapHistoryEntry({
      type: 'outgoing',
      idMessage: 'provider-4',
      timestamp: 1_755_000_000,
      chatId: '10000000',
      typeMessage: 'stickerMessage',
      text: null,
      statusMessage: 'delivered',
      stickerUrl: 'https://media.example/sticker.webp',
      stickerMimeType: 'image/webp',
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
    })

    expect(draft).not.toBeNull()
    if (draft === null) {
      return
    }
    expect(draft.text).toBe('')
    expect(messagePreview(draft)).toBe('Стикер')
  })

  it('converts a provider unix timestamp from seconds and does not keep milliseconds', () => {
    expect(unixSecondsToMillis(1_763_115_112)).toBe(1_763_115_112_000)
    expect(mapHistoryEntry(entry(1_763_115_112))?.sentAt).toBe(
      1_763_115_112_000,
    )
    expect(mapHistoryEntry(entry(1_763_115_112))?.createdAt).toBe(
      1_763_115_112_000,
    )
    expect(unixSecondsToMillis(1_700_000_000_000)).toBe(1_700_000_000_000_000)
  })

  it('does not invent the current time when the provider timestamp is invalid', () => {
    expect(unixSecondsToMillis(-1)).toBeNull()
    expect(unixSecondsToMillis(1.5)).toBeNull()
    expect(unixSecondsToMillis(Number.NaN)).toBeNull()
    expect(mapHistoryEntry(entry(-1))?.sentAt).toBeNull()
  })

  it('does not map an edit, reaction, or deletion as an unsupported message', () => {
    expect(
      mapHistoryEntry({
        ...entry(1_700_000_000),
        idMessage: 'event-1',
        typeMessage: 'editedMessage',
        text: null,
        editEvent: { originalId: 'provider-1', text: 'Стало' },
      }),
    ).toBeNull()
    expect(
      mapHistoryEntry({
        ...entry(1_700_000_000),
        idMessage: 'event-reaction',
        typeMessage: 'reactionMessage',
        text: null,
        reaction: { targetId: 'provider-seconds', emoji: '👍' },
      }),
    ).toBeNull()
    expect(
      mapHistoryEntry({
        ...entry(1_700_000_000),
        idMessage: 'event-delete',
        typeMessage: 'deletedMessage',
        text: null,
        deletion: { targetId: 'provider-seconds' },
      }),
    ).toBeNull()
    expect(
      mapHistoryEntry({
        ...entry(1_700_000_000),
        typeMessage: 'imageMessage',
        text: null,
      })?.text,
    ).toBe(unsupportedMessageText)
  })

  it('marks a history row edited without changing it into another message', () => {
    expect(
      mapHistoryEntry({
        ...entry(1_700_000_000),
        text: 'Стало',
        isEdited: true,
        editedMessageId: 'provider-seconds',
      }),
    ).toMatchObject({
      providerId: 'provider-seconds',
      text: 'Стало',
      edited: true,
      createdAt: 1_700_000_000_000,
    })
  })

  it('keeps a forwarded history row without inventing an author', () => {
    expect(
      mapHistoryEntry({
        ...entry(1_755_000_000),
        idMessage: 'provider-fwd',
        text: 'Пересланный текст',
        forwarded: true,
        forwardingScore: 3,
      }),
    ).toMatchObject({
      providerId: 'provider-fwd',
      text: 'Пересланный текст',
      forwarded: true,
      forwardingScore: 3,
    })
    expect(
      mapHistoryEntry({
        ...entry(1_755_000_000),
        forwarded: true,
        forwardingScore: 3,
      }),
    ).not.toHaveProperty('originName')
  })
})

function entry(timestamp: number) {
  return {
    type: 'outgoing' as const,
    idMessage: 'provider-seconds',
    timestamp,
    chatId: '10000000',
    typeMessage: 'textMessage',
    text: 'Привет',
    statusMessage: 'sent' as const,
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
  }
}
