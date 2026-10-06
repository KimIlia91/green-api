import { useEffect, type RefObject } from 'react'

import { markIncomingViewed, useChatStore } from '@/entities/chat'
import { useMessageStore } from '@/entities/message'

import {
  incomingIdsInView,
  latestIncomingReadTarget,
  type IncomingReadCandidate,
} from '../model/incoming-view.ts'
import { armIncomingRead, scheduleIncomingRead } from '../model/read-receipt.ts'

const minimumVisiblePx = 8

export function useAcknowledgeIncoming(
  chatId: string,
  scrollerRef: RefObject<HTMLElement | null>,
): void {
  const unseenKey = useChatStore(
    (state) => state.chatsById[chatId]?.unseenIncomingIds.join('\n') ?? '',
  )
  const threadKey = useMessageStore(
    (state) => state.messageIdsByChatId[chatId]?.join('\n') ?? '',
  )

  useEffect(() => {
    armIncomingRead(chatId)
  }, [chatId])

  useEffect(() => {
    const root = scrollerRef.current
    if (root === null || chatId === '') {
      return
    }

    const publish = () => {
      const unseen =
        useChatStore.getState().chatsById[chatId]?.unseenIncomingIds ?? []
      const ordered = incomingCandidates(chatId)
      const documentVisible = document.visibilityState === 'visible'
      const conversationVisible = root.getClientRects().length > 0
      const visibleMessageIds =
        documentVisible && conversationVisible
          ? reachedMessageIds(
              root,
              ordered.map((item) => item.providerId),
            )
          : []
      const ids = incomingIdsInView({
        documentVisible,
        conversationVisible,
        unseenIds: unseen,
        visibleMessageIds,
      })
      if (ids.length > 0) {
        markIncomingViewed(chatId, ids)
      }

      const idMessage = latestIncomingReadTarget({
        documentVisible,
        conversationVisible,
        ordered,
        visibleProviderIds: visibleMessageIds,
      })
      if (idMessage !== null) {
        scheduleIncomingRead({ chatId, idMessage })
      }
    }

    root.addEventListener('scroll', publish)
    document.addEventListener('visibilitychange', publish)
    const observer = new MutationObserver(publish)
    observer.observe(root, { childList: true, subtree: true })
    const frame = requestAnimationFrame(publish)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      root.removeEventListener('scroll', publish)
      document.removeEventListener('visibilitychange', publish)
    }
  }, [chatId, scrollerRef, threadKey, unseenKey])
}

function incomingCandidates(chatId: string): IncomingReadCandidate[] {
  const state = useMessageStore.getState()
  const ids = state.messageIdsByChatId[chatId] ?? []
  const candidates: IncomingReadCandidate[] = []
  for (const localId of ids) {
    const message = state.messagesById[localId]
    const providerId = message?.providerId?.trim() ?? ''
    if (message === undefined || providerId === '') {
      continue
    }
    candidates.push({
      providerId,
      direction: message.direction,
    })
  }
  return candidates
}

function reachedMessageIds(
  root: HTMLElement,
  unseenIds: readonly string[],
): string[] {
  const rootRect = root.getBoundingClientRect()
  const reached: string[] = []
  for (const id of unseenIds) {
    const node = root.querySelector(`[data-provider-id="${CSS.escape(id)}"]`)
    if (!(node instanceof HTMLElement)) {
      continue
    }

    const rect = node.getBoundingClientRect()
    const visibleHeight =
      Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top)
    if (visibleHeight >= Math.min(minimumVisiblePx, rect.height)) {
      reached.push(id)
    }
  }
  return reached
}
