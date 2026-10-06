import { describe, expect, it } from 'vitest'

import { editWindowMs } from '@/entities/message'

import {
  messageMenuActions,
  type MessageMenuSubject,
} from '@/widgets/chat-window/model/message-menu-actions.ts'

const now = 1_700_000_000_000
const chatId = '10000000'

const textMessage: MessageMenuSubject = {
  providerId: 'provider-text',
  chatId,
  text: 'Привет',
  stickerUrl: null,
  direction: 'outgoing',
  sentAt: now - 60_000,
}

describe('message menu actions', () => {
  it('offers the text actions for a recent outgoing message', () => {
    expect(actions(textMessage)).toEqual([
      'reply',
      'edit',
      'copy',
      'forward',
      'delete',
      'select',
    ])
  })

  it('keeps text actions for a quoted or forwarded text message', () => {
    expect(
      actions({
        ...textMessage,
        direction: 'incoming',
      }),
    ).toEqual(['reply', 'copy', 'forward', 'select'])
  })

  it('keeps sticker actions for a forwarded sticker without text', () => {
    expect(
      actions({
        ...textMessage,
        text: '',
        stickerUrl: 'https://media.example/sticker.png',
      }),
    ).toEqual(['delete'])
  })

  it('hides edit and delete for an incoming text message', () => {
    expect(
      actions({
        ...textMessage,
        direction: 'incoming',
      }),
    ).toEqual(['reply', 'copy', 'forward', 'select'])
  })

  it('hides reply, edit, forward and delete without a provider id', () => {
    expect(actions({ ...textMessage, providerId: '  ' })).toEqual([
      'copy',
      'select',
    ])
  })

  it('hides edit after the edit window', () => {
    expect(
      actions({
        ...textMessage,
        sentAt: now - editWindowMs,
      }),
    ).not.toContain('edit')
  })

  it('shows only delete for an outgoing sticker without text', () => {
    expect(
      actions({
        ...textMessage,
        text: '',
        stickerUrl: 'https://media.example/sticker.png',
      }),
    ).toEqual(['delete'])
  })

  it('shows nothing for an incoming sticker without text', () => {
    expect(
      actions({
        ...textMessage,
        text: '',
        stickerUrl: 'https://media.example/sticker.png',
        direction: 'incoming',
      }),
    ).toEqual([])
  })

  it('does not copy a sticker caption', () => {
    expect(
      actions({
        ...textMessage,
        text: 'подпись',
        stickerUrl: 'https://media.example/sticker.png',
      }),
    ).not.toContain('copy')
  })

  it('does not offer copy, reply, forward or select for the unsupported placeholder', () => {
    expect(
      actions({
        ...textMessage,
        text: 'Этот тип сообщения не поддерживается',
      }),
    ).toEqual(['delete'])
  })
})

function actions(message: MessageMenuSubject) {
  return messageMenuActions(message, {
    activeChatId: chatId,
    contactTitle: 'Контакт',
    now,
  })
}
