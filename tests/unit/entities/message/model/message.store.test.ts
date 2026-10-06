import { beforeEach, describe, expect, it } from 'vitest'

import {
  addMessage,
  mergeChatHistory,
  rememberMessageOrigin,
  removeMessage,
  resetMessages,
  updateMessage,
  useMessageStore,
} from '@/entities/message/model/message.store.ts'
import {
  selectLocalIdByProviderId,
  selectMessageById,
  selectMessageIds,
} from '@/entities/message/model/message.selectors.ts'
import type { Message } from '@/entities/message/model/message.types.ts'

const first: Message = {
  localId: 'local-1',
  providerId: null,
  chatId: '10000000',
  text: 'Привет',
  stickerUrl: null,
  stickerMimeType: null,
  direction: 'outgoing',
  createdAt: 1_700_000_000_000,
  sentAt: 1_700_000_000_000,
  sendState: 'sending',
  errorText: null,
}

describe('message store', () => {
  beforeEach(() => {
    resetMessages()
  })

  it('keeps localId when a provider id arrives', () => {
    addMessage(first)
    const ids = selectMessageIds(first.chatId)(useMessageStore.getState())

    updateMessage(first.localId, {
      providerId: '1763115112345',
      sendState: 'queued',
    })

    const state = useMessageStore.getState()
    expect(selectMessageIds(first.chatId)(state)).toBe(ids)
    expect(selectMessageById(first.localId)(state)?.providerId).toBe(
      '1763115112345',
    )
    expect(selectLocalIdByProviderId('1763115112345')(state)).toBe('local-1')
    expect(state.messagesById['local-1']?.localId).toBe('local-1')
  })

  it('does not replace sentAt when the text changes', () => {
    addMessage(first)
    updateMessage(first.localId, {
      text: 'Новый',
      sentAt: 9,
    } as { text: string })

    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      text: 'Новый',
      sentAt: first.sentAt,
    })
  })

  it('does not add a second row for the same local id', () => {
    addMessage(first)
    addMessage({ ...first, text: 'Другой текст' })

    expect(selectMessageIds(first.chatId)(useMessageStore.getState())).toEqual([
      'local-1',
    ])
  })

  it('resets messages', () => {
    addMessage(first)
    resetMessages()

    expect(useMessageStore.getState().messagesById).toEqual({})
    expect(selectMessageIds(first.chatId)(useMessageStore.getState())).toEqual(
      [],
    )
  })

  it('keeps a known author when history later marks the same message forwarded', () => {
    addMessage({ ...first, providerId: 'provider-1', originName: 'Вы' })
    mergeChatHistory(
      '10000000',
      [
        {
          providerId: 'provider-1',
          chatId: '10000000',
          text: 'Привет',
          stickerUrl: null,
          stickerMimeType: null,
          direction: 'outgoing',
          createdAt: 1_700_000_000_000,
          sentAt: 1_700_000_000_000,
          sendState: 'sent',
          forwarded: true,
          forwardingScore: 1,
        },
      ],
      () => 'local-new',
    )

    expect(useMessageStore.getState().messagesById['local-1']).toMatchObject({
      forwarded: true,
      originName: 'Вы',
    })
    expect(useMessageStore.getState().messagesById['local-new']).toBeUndefined()
  })

  it('does not assign an author to a message that is already forwarded', () => {
    addMessage({
      ...first,
      providerId: 'provider-1',
      forwarded: true,
      originName: null,
    })
    rememberMessageOrigin('local-1', 'Анна')
    expect(useMessageStore.getState().messagesById['local-1']?.originName).toBe(
      null,
    )
  })

  it('drops a removed message from the thread and the provider index', () => {
    addMessage({ ...first, providerId: 'provider-1' })
    removeMessage('local-1')
    const state = useMessageStore.getState()
    expect(state.messagesById['local-1']).toBeUndefined()
    expect(state.localIdByProviderId['provider-1']).toBeUndefined()
    expect(selectMessageIds(first.chatId)(state)).toEqual([])
  })
})
