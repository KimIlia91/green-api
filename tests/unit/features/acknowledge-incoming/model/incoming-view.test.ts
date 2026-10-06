import { describe, expect, it } from 'vitest'

import {
  markIncomingViewed,
  noteUnseenIncoming,
  resetChats,
  upsertChat,
  useChatStore,
} from '@/entities/chat'

import {
  incomingIdsInView,
  latestIncomingReadTarget,
} from '@/features/acknowledge-incoming/model/incoming-view.ts'

describe('incoming view', () => {
  it('marks only the new messages the user has reached', () => {
    expect(
      incomingIdsInView({
        documentVisible: true,
        conversationVisible: true,
        unseenIds: ['one', 'two'],
        visibleMessageIds: ['two', 'old'],
      }),
    ).toEqual(['two'])
  })

  it('does not treat a hidden tab as a view', () => {
    expect(
      incomingIdsInView({
        documentVisible: false,
        conversationVisible: true,
        unseenIds: ['one'],
        visibleMessageIds: ['one'],
      }),
    ).toEqual([])
  })

  it('does not treat the hidden mobile conversation as a view', () => {
    expect(
      incomingIdsInView({
        documentVisible: true,
        conversationVisible: false,
        unseenIds: ['one'],
        visibleMessageIds: ['one'],
      }),
    ).toEqual([])
  })

  it('does not choose a read target while the tab or the conversation is hidden', () => {
    const ordered = [
      { providerId: 'history-1', direction: 'incoming' as const },
    ]
    expect(
      latestIncomingReadTarget({
        documentVisible: false,
        conversationVisible: true,
        ordered,
        visibleProviderIds: ['history-1'],
      }),
    ).toBeNull()
    expect(
      latestIncomingReadTarget({
        documentVisible: true,
        conversationVisible: false,
        ordered,
        visibleProviderIds: ['history-1'],
      }),
    ).toBeNull()
  })

  it('marks a visible history message and keeps the latest row in the thread', () => {
    expect(
      latestIncomingReadTarget({
        documentVisible: true,
        conversationVisible: true,
        ordered: [
          { providerId: '100', direction: 'incoming' },
          { providerId: 'out-1', direction: 'outgoing' },
          { providerId: ' ', direction: 'incoming' },
          { providerId: '9', direction: 'incoming' },
        ],
        visibleProviderIds: ['100', 'out-1', ' ', '9'],
      }),
    ).toBe('9')
  })

  it('does not clear messages that are still below the viewport', () => {
    expect(
      incomingIdsInView({
        documentVisible: true,
        conversationVisible: true,
        unseenIds: ['one'],
        visibleMessageIds: [],
      }),
    ).toEqual([])
  })

  it('forgets a viewed incoming id after logout', () => {
    resetChats()
    upsertChat({
      chatId: '10000000',
      phoneNumber: null,
      name: 'Анна',
      username: null,
    })
    noteUnseenIncoming('10000000', 'incoming-1')
    markIncomingViewed('10000000', ['incoming-1'])
    resetChats()
    upsertChat({
      chatId: '10000000',
      phoneNumber: null,
      name: 'Анна',
      username: null,
    })
    noteUnseenIncoming('10000000', 'incoming-1')

    expect(
      useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
    ).toEqual(['incoming-1'])
    resetChats()
  })
})
