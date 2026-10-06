import { beforeEach, describe, expect, it } from 'vitest'

import {
  markIncomingViewed,
  mergeRemoteChats,
  noteUnseenIncoming,
  recordChatActivity,
  refreshPreviewText,
  resetChats,
  selectChat,
  upsertChat,
  useChatStore,
} from '@/entities/chat/model/chat.store.ts'
import { chatTitle } from '@/entities/chat/model/chat-title.ts'
import {
  selectActiveChat,
  selectChatById,
  selectChatIds,
} from '@/entities/chat/model/chat.selectors.ts'

const firstChat = {
  chatId: '10000000',
  phoneNumber: '79991234567',
  name: null,
  username: null,
}

describe('chat store', () => {
  beforeEach(() => {
    resetChats()
  })

  it('keeps the chat id list stable until the list changes', () => {
    const initialIds = selectChatIds(useChatStore.getState())

    upsertChat(firstChat)
    const afterInsert = selectChatIds(useChatStore.getState())
    upsertChat(firstChat)

    expect(selectChatIds(useChatStore.getState())).toBe(afterInsert)
    expect(afterInsert).not.toBe(initialIds)
    expect(afterInsert).toEqual(['10000000'])
  })

  it('does not duplicate an existing chat id', () => {
    upsertChat(firstChat)
    upsertChat({
      ...firstChat,
      phoneNumber: '79990000000',
      name: 'Анна',
    })

    expect(useChatStore.getState().chatIds).toEqual(['10000000'])
    expect(useChatStore.getState().chatsById['10000000']?.phoneNumber).toBe(
      '79990000000',
    )
  })

  it('updates displayed chat data when the same chat id is upserted', () => {
    upsertChat(firstChat)
    selectChat(firstChat.chatId)
    const chatIds = selectChatIds(useChatStore.getState())

    upsertChat({
      chatId: firstChat.chatId,
      phoneNumber: '375291234567',
      name: 'Анна',
      username: null,
    })

    const state = useChatStore.getState()
    const displayed = selectChatById(firstChat.chatId)(state)

    const active = selectActiveChat(state)

    expect(selectChatIds(state)).toBe(chatIds)
    expect(displayed).toEqual({
      chatId: '10000000',
      phoneNumber: '375291234567',
      name: 'Анна',
      username: null,
      preview: null,
      previewForwarded: false,
      lastActivityAt: null,
      unseenIncomingIds: [],
    })
    expect(active).not.toBeNull()
    if (active) {
      expect(chatTitle(active)).toBe('Анна')
    }
    expect(active?.phoneNumber).toBe('375291234567')
  })

  it('selects a chat and resets the list', () => {
    upsertChat(firstChat)
    selectChat(firstChat.chatId)

    expect(selectActiveChat(useChatStore.getState())?.chatId).toBe('10000000')

    resetChats()

    expect(useChatStore.getState()).toMatchObject({
      chatsById: {},
      chatIds: [],
      activeChatId: null,
    })
  })

  it('merges personal chats without duplicates, blanks, or activity loss', () => {
    upsertChat({
      chatId: 'local-chat',
      phoneNumber: '79990000000',
      name: 'Новый',
      username: null,
    })
    selectChat('local-chat')
    upsertChat(firstChat)
    recordChatActivity(firstChat.chatId, {
      preview: 'Свежее',
      at: 50,
    })
    noteUnseenIncoming(firstChat.chatId, 'incoming-a')
    noteUnseenIncoming(firstChat.chatId, 'incoming-b')

    mergeRemoteChats([
      { chatId: '10000000', name: ' ', phoneNumber: null },
      { chatId: '10000000', name: null, phoneNumber: null },
      { chatId: '30000000', name: '', phoneNumber: null },
      { chatId: '40000000', name: 'Борис', phoneNumber: '375291112233' },
    ])

    const state = useChatStore.getState()
    expect(state.chatIds).toEqual([
      'local-chat',
      '10000000',
      '30000000',
      '40000000',
    ])
    expect(state.activeChatId).toBe('local-chat')
    expect(state.chatsById['10000000']).toMatchObject({
      phoneNumber: '79991234567',
      name: null,
      preview: 'Свежее',
      unseenIncomingIds: ['incoming-a', 'incoming-b'],
    })
    const unnamed = state.chatsById['30000000']
    expect(unnamed).toMatchObject({
      name: null,
      phoneNumber: null,
      preview: null,
      unseenIncomingIds: [],
    })
    if (unnamed) {
      expect(chatTitle(unnamed)).toBe('Контакт без имени')
    }
    expect(state.chatsById['local-chat']?.name).toBe('Новый')
  })

  it('does not replace a newer preview with an older activity', () => {
    upsertChat(firstChat)
    noteUnseenIncoming(firstChat.chatId, 'incoming-new')
    recordChatActivity(firstChat.chatId, {
      preview: 'Новое',
      at: 20,
    })
    recordChatActivity(firstChat.chatId, {
      preview: 'Старое',
      at: 10,
    })

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Новое',
      lastActivityAt: 20,
      unseenIncomingIds: ['incoming-new'],
    })
  })

  it('orders chats by message time and keeps equal times stable', () => {
    upsertChat(firstChat)
    upsertChat({
      chatId: '20000000',
      phoneNumber: null,
      name: 'Борис',
      username: null,
    })
    upsertChat({
      chatId: '30000000',
      phoneNumber: null,
      name: null,
      username: null,
    })
    const withoutActivity = selectChatIds(useChatStore.getState())

    recordChatActivity('20000000', {
      preview: 'одно время',
      at: 10,
    })
    recordChatActivity('10000000', {
      preview: 'тоже',
      at: 10,
    })

    expect(selectChatIds(useChatStore.getState())).toEqual([
      '10000000',
      '20000000',
      '30000000',
    ])
    expect(withoutActivity).toEqual(['10000000', '20000000', '30000000'])

    recordChatActivity('20000000', {
      preview: 'новее',
      at: 11,
    })
    const ordered = selectChatIds(useChatStore.getState())
    recordChatActivity('20000000', {
      preview: 'старее',
      at: 9,
    })

    expect(selectChatIds(useChatStore.getState())).toBe(ordered)
    expect(ordered).toEqual(['20000000', '10000000', '30000000'])
    expect(useChatStore.getState().chatsById['20000000']?.preview).toBe('новее')
  })

  it('keeps a forward mark on the current last message until a newer plain one', () => {
    upsertChat(firstChat)
    recordChatActivity(firstChat.chatId, {
      preview: 'Переслано',
      at: 20,
      forwarded: true,
    })
    refreshPreviewText(firstChat.chatId, 'Новый текст', 20)

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Новый текст',
      previewForwarded: true,
      lastActivityAt: 20,
    })

    recordChatActivity(firstChat.chatId, {
      preview: 'Обычное',
      at: 21,
    })

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'Обычное',
      previewForwarded: false,
      lastActivityAt: 21,
    })
  })

  it('keeps unseen incoming when the route selects the chat', () => {
    upsertChat(firstChat)
    noteUnseenIncoming(firstChat.chatId, 'incoming-1')
    selectChat(firstChat.chatId)

    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual(['incoming-1'])
  })

  it('clears only the incoming messages that were actually viewed', () => {
    upsertChat(firstChat)
    noteUnseenIncoming(firstChat.chatId, 'incoming-1')
    noteUnseenIncoming(firstChat.chatId, 'incoming-2')
    markIncomingViewed(firstChat.chatId, ['incoming-1'])

    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual(['incoming-2'])

    markIncomingViewed(firstChat.chatId, ['incoming-2'])
    noteUnseenIncoming(firstChat.chatId, 'incoming-1')
    noteUnseenIncoming(firstChat.chatId, 'incoming-2')

    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual([])
  })

  it('drops unseen incoming on logout and ignores a late id for a missing chat', () => {
    upsertChat(firstChat)
    noteUnseenIncoming(firstChat.chatId, 'incoming-1')
    resetChats()
    noteUnseenIncoming(firstChat.chatId, 'late')

    expect(useChatStore.getState().chatsById).toEqual({})
    expect(useChatStore.getState().viewedIncomingIds).toEqual([])
  })
})
