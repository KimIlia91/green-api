import { beforeEach, describe, expect, it } from 'vitest'

import {
  noteUnseenIncoming,
  resetChats,
  upsertChat,
  useChatStore,
} from '@/entities/chat'
import { addMessage, resetMessages, useMessageStore } from '@/entities/message'
import { clearDrafts, setDraft, useDraftStore } from '@/features/send-message'

import { syncRouteChat } from '@/app/router/sync-route-chat.ts'

describe('syncRouteChat', () => {
  beforeEach(() => {
    resetChats()
    resetMessages()
    clearDrafts()
  })

  it('selects the chat named by the route', () => {
    upsertChat(chat('10000000'))
    noteUnseenIncoming('10000000', 'incoming-1')

    syncRouteChat('10000000')

    const state = useChatStore.getState()
    expect(state.activeChatId).toBe('10000000')
    expect(state.chatsById['10000000']?.unseenIncomingIds).toEqual([
      'incoming-1',
    ])
  })

  it('clears the active chat when the route returns to the list', () => {
    upsertChat(chat('10000000'))
    syncRouteChat('10000000')
    addMessage(storedMessage)
    setDraft('10000000', 'черновик')

    syncRouteChat(null)

    expect(useChatStore.getState().activeChatId).toBeNull()
    expect(useChatStore.getState().chatIds).toEqual(['10000000'])
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'local-1',
    ])
    expect(useDraftStore.getState().draftsByChatId['10000000']).toEqual({
      text: 'черновик',
      reply: null,
    })
  })

  it('does not invent a chat for an unknown string id', () => {
    syncRouteChat('missing-chat')

    expect(useChatStore.getState().chatIds).toEqual([])
    expect(useChatStore.getState().activeChatId).toBeNull()
  })

  it('keeps a chat created before the list finishes', () => {
    upsertChat(chat('local-chat'))

    syncRouteChat('local-chat')

    expect(useChatStore.getState().activeChatId).toBe('local-chat')
  })

  it('does not write the store again for the same active chat', () => {
    upsertChat(chat('10000000'))
    syncRouteChat('10000000')
    const state = useChatStore.getState()

    syncRouteChat('10000000')

    expect(useChatStore.getState()).toBe(state)
  })

  it('switches the active chat without dropping messages or drafts', () => {
    upsertChat(chat('10000000'))
    upsertChat(chat('20000000'))
    addMessage({
      localId: 'local-1',
      providerId: null,
      chatId: '10000000',
      text: 'Привет',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: 1,
      sentAt: null,
      sendState: 'queued',
      errorText: null,
    })
    setDraft('10000000', 'черновик')
    syncRouteChat('10000000')

    syncRouteChat('20000000')

    expect(useChatStore.getState().activeChatId).toBe('20000000')
    expect(useMessageStore.getState().messagesById['local-1']?.text).toBe(
      'Привет',
    )
    expect(useDraftStore.getState().draftsByChatId['10000000']).toEqual({
      text: 'черновик',
      reply: null,
    })
  })
})

const storedMessage = {
  localId: 'local-1',
  providerId: null,
  chatId: '10000000',
  text: 'история',
  stickerUrl: null,
  stickerMimeType: null,
  direction: 'outgoing' as const,
  createdAt: 1,
  sentAt: null,
  sendState: 'queued' as const,
  errorText: null,
}

function chat(chatId: string) {
  return {
    chatId,
    phoneNumber: '79991234567',
    name: 'Анна',
    username: null as string | null,
  }
}
