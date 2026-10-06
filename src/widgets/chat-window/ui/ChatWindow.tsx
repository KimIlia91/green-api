import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  chatInitials,
  chatTitle,
  selectChatById,
  useChatStore,
} from '@/entities/chat'
import {
  selectHistoryStamp,
  selectMessageIds,
  unloadedQuoteNotice,
  useMessageStore,
} from '@/entities/message'
import {
  useAcknowledgeIncoming,
  useIncomingReadStore,
} from '@/features/acknowledge-incoming'
import { ensureContactProfile } from '@/features/create-chat'
import {
  loadChatHistory,
  selectHistoryError,
  selectHistoryPhase,
  useLoadHistoryStore,
} from '@/features/load-chat-history'
import {
  holdChatPreview,
  releaseChatPreview,
  skipChatPreview,
} from '@/features/load-chat-previews'
import {
  chatListErrorMessage,
  loadChatList,
  selectChatListError,
  useLoadChatsStore,
} from '@/features/load-chats'
import {
  beginEdit,
  cancelEdit,
  markEditExpiry,
  saveEditedMessage,
  selectEditSession,
  setEditText,
  useEditStore,
} from '@/features/edit-message'
import {
  beginSelection,
  clearSelection,
  retainSelection,
  useSelectionStore,
} from '@/features/select-messages'
import { replySelectionFor } from '@/features/reply-to-message'
import {
  clearReply,
  MessageComposer,
  requestComposerFocus,
  retryChatMessage,
  setReply,
} from '@/features/send-message'
import { Button, IconButton, Spinner } from '@/shared/ui'

import {
  nextFloatingDate,
  type DayMarker,
  type FloatingDate,
} from '../model/floating-date.ts'
import type { HeaderFace } from '../model/header-phase.ts'
import {
  distanceFromThreadBottom,
  isNearThreadBottom,
  nextJumpButtonVisible,
} from '../model/jump-button.ts'
import {
  bottomScrollTop,
  isThreadScrollKey,
  nextThreadFollow,
  nextThreadScroll,
  quoteScrollTop,
  type ThreadFollow,
  type ThreadScrollAnchor,
} from '../model/thread-scroll.ts'
import { buildThreadItems } from '../model/thread.ts'
import { useEditClock } from '../model/useEditClock.ts'
import { useMessageMenu } from '../model/useMessageMenu.ts'
import styles from './ChatWindow.module.css'
import {
  DirectMessageAction,
  type DirectMessageActionState,
} from './DirectMessageAction.tsx'
import { MessageActionRow, MessageMenuOverlay } from './MessageMenu.tsx'
import { SelectionDock } from './SelectionDock.tsx'
import { useLeavingHeader } from './useLeavingHeader.ts'
import { useMessageDayClock } from './useMessageDayClock.ts'

type DirectView = 'browse' | 'open' | 'loading' | 'error' | 'missing'

type ChatWindowProps = {
  onBack: () => void
  routeChatId: string | null
  directView: DirectView
}

export function ChatWindow({
  onBack,
  routeChatId,
  directView,
}: ChatWindowProps) {
  const chat = useChatStore(selectChatById(routeChatId ?? ''))
  const openChat = directView === 'open' && chat !== undefined ? chat : null
  const openChatId = openChat?.chatId ?? ''
  const phase = useLoadHistoryStore(selectHistoryPhase(openChatId))
  const listError = useLoadChatsStore(selectChatListError)
  const face: HeaderFace | null =
    openChat === null
      ? null
      : {
          chatId: openChat.chatId,
          title: chatTitle(openChat),
          initials: chatInitials(openChat),
        }
  const leaving = useLeavingHeader(face)
  const editing = useEditStore(selectEditSession)
  const selectionChatId = useSelectionStore((state) => state.chatId)
  const [directAction, setDirectAction] =
    useState<DirectMessageActionState | null>(null)
  const [actionNotice, setActionNotice] = useState('')
  const readNotice = useIncomingReadStore((state) =>
    state.noticeChatId === openChatId ? state.notice : '',
  )
  const statusNotice = actionNotice !== '' ? actionNotice : readNotice
  const [actionChatId, setActionChatId] = useState(openChatId)
  if (actionChatId !== openChatId) {
    setActionChatId(openChatId)
    setDirectAction(null)
    setActionNotice('')
  }

  useEffect(() => {
    useIncomingReadStore.getState().clearNotice()
  }, [openChatId])

  useEffect(() => {
    if (editing !== null && editing.chatId !== openChatId) {
      cancelEdit()
    }
  }, [editing, openChatId])

  useEffect(() => {
    const current = useSelectionStore.getState().chatId
    if (current !== null && current !== openChatId) {
      clearSelection()
    }
  }, [openChatId])

  useEffect(() => {
    if (openChatId === '') {
      return
    }

    holdChatPreview(openChatId)
    void loadChatHistory(openChatId)
    ensureContactProfile(openChatId)
  }, [openChatId])

  useEffect(() => {
    if (openChatId === '') {
      return
    }
    if (phase === 'ready') {
      skipChatPreview(openChatId)
      return
    }
    if (phase === 'error') {
      releaseChatPreview(openChatId)
    }
  }, [openChatId, phase])

  return (
    <div className={styles.window}>
      {face !== null ? (
        <ChatHeading face={face} onBack={onBack} />
      ) : leaving !== null ? (
        <ChatHeading face={leaving} leaving />
      ) : null}
      {openChat ? (
        <MessageList
          key={openChat.chatId}
          chatId={openChat.chatId}
          onForward={(localId) => {
            cancelEdit()
            setActionNotice('')
            setDirectAction({ kind: 'forward', localId })
          }}
          onDelete={(localId) => {
            cancelEdit()
            setActionNotice('')
            setDirectAction({ kind: 'delete', localId })
          }}
          onSelect={(localId) => {
            setDirectAction(null)
            cancelEdit()
            beginSelection(openChat.chatId, localId)
          }}
        />
      ) : directView === 'browse' ? null : (
        <RouteChatStatus
          directView={directView}
          listError={listError}
          onBack={onBack}
        />
      )}
      {openChat && statusNotice !== '' ? (
        <p className={styles.actionNotice} role="status">
          {statusNotice}
        </p>
      ) : null}
      {openChat ? (
        directAction?.kind === 'forward' ? (
          <DirectMessageAction
            chatId={openChat.chatId}
            action={directAction}
            onClose={() => {
              setDirectAction(null)
            }}
            onNotice={setActionNotice}
          />
        ) : selectionChatId === openChat.chatId ? (
          <SelectionDock chatId={openChat.chatId} />
        ) : (
          <MessageComposer
            editing={
              editing !== null && editing.chatId === openChat.chatId
                ? {
                    text: editing.text,
                    preview: editing.preview,
                    notice: editing.notice,
                    onText: setEditText,
                    onCancel: cancelEdit,
                    onSave: () => {
                      const session = useEditStore.getState().session
                      if (session === null) {
                        return
                      }
                      void saveEditedMessage(session.localId, session.text)
                    },
                  }
                : null
            }
          />
        )
      ) : null}
      {openChat && directAction?.kind === 'delete' ? (
        <DirectMessageAction
          chatId={openChat.chatId}
          action={directAction}
          onClose={() => {
            setDirectAction(null)
          }}
          onNotice={setActionNotice}
        />
      ) : null}
    </div>
  )
}

function ChatHeading({
  face,
  onBack,
  leaving = false,
}: {
  face: HeaderFace
  onBack?: () => void
  leaving?: boolean
}) {
  return (
    <header
      className={leaving ? styles.headerLeaving : styles.header}
      aria-hidden={leaving ? true : undefined}
      inert={leaving ? true : undefined}
    >
      {leaving ? (
        <span className={styles.back}>
          <BackIcon />
        </span>
      ) : (
        <IconButton
          label="Вернуться к списку чатов"
          className={styles.back}
          onClick={onBack}
        >
          <BackIcon />
        </IconButton>
      )}
      <div className={styles.recipient}>
        <span className={styles.avatar} aria-hidden="true">
          {face.initials}
        </span>
        <h2 className={styles.name}>{face.title}</h2>
      </div>
    </header>
  )
}

function RouteChatStatus({
  directView,
  listError,
  onBack,
}: {
  directView: DirectView
  listError: string | null
  onBack: () => void
}) {
  if (directView === 'loading') {
    return (
      <div className={styles.status}>
        <Spinner label="Загрузка чатов" />
      </div>
    )
  }

  if (directView === 'error') {
    return (
      <div className={styles.status}>
        <p className={styles.statusError}>
          {listError ?? chatListErrorMessage}
        </p>
        <Button
          type="button"
          onClick={() => {
            void loadChatList()
          }}
        >
          Повторить
        </Button>
      </div>
    )
  }

  if (directView === 'missing') {
    return (
      <div className={styles.status}>
        <p>Чат недоступен</p>
        <Button type="button" onClick={onBack}>
          К списку чатов
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.empty}>
      <p>Выберите чат или создайте новый.</p>
    </div>
  )
}

function MessageList({
  chatId,
  onForward,
  onDelete,
  onSelect,
}: {
  chatId: string
  onForward: (localId: string) => void
  onDelete: (localId: string) => void
  onSelect: (localId: string) => void
}) {
  const chat = useChatStore(selectChatById(chatId))
  const contactTitle = chat === undefined ? '' : chatTitle(chat)
  const ids = useMessageStore(selectMessageIds(chatId))
  const stamp = useMessageStore(selectHistoryStamp(chatId))
  const phase = useLoadHistoryStore(selectHistoryPhase(chatId))
  const errorText = useLoadHistoryStore(selectHistoryError(chatId))
  const now = useMessageDayClock()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const jumpRef = useRef<HTMLButtonElement>(null)
  const jumpVisibleRef = useRef(false)
  const [jumpVisible, setJumpVisible] = useState(false)
  const floatingRef = useRef<FloatingDate | null>(null)
  const floatingFrameRef = useRef(0)
  const [floating, setFloating] = useState<FloatingDate | null>(null)
  useAcknowledgeIncoming(chatId, scrollerRef)
  const followRef = useRef<ThreadFollow>('bottom')
  const anchorRef = useRef<(ThreadScrollAnchor & { stamp: number }) | null>(
    null,
  )
  const programmaticRef = useRef(false)
  const jumpingRef = useRef(false)
  const userScrollRef = useRef(false)
  const touchScrollTopRef = useRef<number | null>(null)
  const blockedTargetRef = useRef<number | null>(null)
  const seenRef = useRef<Set<string> | null>(null)
  const stampRef = useRef(stamp)
  const [animated, setAnimated] = useState<ReadonlySet<string>>(new Set())
  const [quoteNotice, setQuoteNotice] = useState('')
  const quoteNoticeTimer = useRef(0)
  const quoteHighlightTimer = useRef(0)
  const messageMenu = useMessageMenu(chatId)
  const closeMessageMenu = messageMenu.closeMenu
  const selectionChatId = useSelectionStore((state) => state.chatId)
  const editing = useEditStore(selectEditSession)
  const editNow = useEditClock([
    messageMenu.session?.phase === 'open' ? messageMenu.session.localId : null,
    editing?.localId ?? null,
  ])

  useEffect(() => {
    markEditExpiry(editNow)
  }, [editNow])

  useEffect(() => {
    if (selectionChatId !== chatId) {
      return
    }
    closeMessageMenu('outside')
  }, [chatId, closeMessageMenu, selectionChatId])

  useEffect(() => {
    if (selectionChatId !== chatId) {
      return
    }
    retainSelection(ids)
  }, [chatId, ids, selectionChatId])
  const noteScroll = messageMenu.noteScroll
  const publishJump = useCallback((element: HTMLDivElement) => {
    const next = nextJumpButtonVisible(jumpVisibleRef.current, {
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
    })
    if (next === jumpVisibleRef.current) {
      return
    }

    jumpVisibleRef.current = next
    if (
      !next &&
      jumpRef.current !== null &&
      document.activeElement === jumpRef.current
    ) {
      element.focus({ preventScroll: true })
    }
    setJumpVisible(next)
  }, [])
  const publishFloating = useCallback(() => {
    const element = scrollerRef.current
    if (element === null) {
      return
    }

    const next = nextFloatingDate(
      floatingRef.current,
      dayMarkers(element),
      element.getBoundingClientRect().top,
    )
    const current = floatingRef.current
    if (current?.label === next?.label && current?.shown === next?.shown) {
      return
    }

    floatingRef.current = next
    setFloating(next)
  }, [])
  const scheduleFloating = useCallback(() => {
    if (floatingFrameRef.current !== 0) {
      return
    }

    floatingFrameRef.current = requestAnimationFrame(() => {
      floatingFrameRef.current = 0
      publishFloating()
    })
  }, [publishFloating])
  const items = useMemo(() => {
    const messages = useMessageStore.getState().messagesById
    return buildThreadItems(
      ids.flatMap((localId) => {
        const message = messages[localId]
        return message === undefined
          ? []
          : [{ localId, createdAt: message.createdAt }]
      }),
      now,
    )
  }, [ids, now])

  if (seenRef.current === null) {
    seenRef.current = new Set(ids)
  }

  useLayoutEffect(() => {
    const seen = seenRef.current ?? new Set<string>()
    if (stamp !== stampRef.current) {
      stampRef.current = stamp
      for (const id of ids) {
        seen.add(id)
      }
      seenRef.current = seen
      setAnimated(new Set())
      return
    }

    const fresh = ids.filter((id) => !seen.has(id))
    for (const id of ids) {
      seen.add(id)
    }
    seenRef.current = seen
    if (fresh.length > 0) {
      setAnimated(new Set(fresh))
    }
  }, [ids, stamp])

  const placeThread = useCallback(
    (historyPrepended: boolean) => {
      const element = scrollerRef.current
      if (element === null) {
        return
      }

      const anchor = anchorRef.current
      const before = element.scrollTop
      const plan = nextThreadScroll({
        port: {
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          scrollTop: element.scrollTop,
        },
        visible: element.getClientRects().length > 0,
        follow: followRef.current,
        anchor,
        historyPrepended,
      })
      if (!plan.applied) {
        return
      }

      if (plan.scrollTop !== element.scrollTop) {
        const requested = plan.scrollTop
        programmaticRef.current = true
        element.scrollTop = requested
        programmaticRef.current = false
        blockedTargetRef.current =
          Math.abs(element.scrollTop - requested) < 1 ? null : requested
      } else {
        blockedTargetRef.current = null
      }

      anchorRef.current = {
        height: element.scrollHeight,
        top: element.scrollTop,
        stamp: stampRef.current,
      }
      publishJump(element)
      publishFloating()
      if (element.scrollTop !== before) {
        noteScroll()
      }
    },
    [noteScroll, publishFloating, publishJump],
  )

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const historyPrepended =
      anchor !== null && stamp !== anchor.stamp && anchor.stamp > 0
    placeThread(historyPrepended)
  }, [items, phase, placeThread, stamp])

  useEffect(() => {
    const element = scrollerRef.current
    return () => {
      window.clearTimeout(quoteNoticeTimer.current)
      window.clearTimeout(quoteHighlightTimer.current)
      element
        ?.querySelector('[data-quote-target]')
        ?.removeAttribute('data-quote-target')
    }
  }, [chatId])

  function revealQuote(sourceId: string) {
    const port = scrollerRef.current
    if (port === null) {
      return
    }

    const target = port.querySelector<HTMLElement>(
      `[data-provider-id="${CSS.escape(sourceId)}"]`,
    )
    if (target === null) {
      setQuoteNotice(unloadedQuoteNotice)
      window.clearTimeout(quoteNoticeTimer.current)
      quoteNoticeTimer.current = window.setTimeout(() => {
        setQuoteNotice('')
      }, 2400)
      return
    }

    setQuoteNotice('')
    followRef.current = 'preserve'
    userScrollRef.current = false
    jumpingRef.current = false
    const top = quoteScrollTop({
      scrollTop: port.scrollTop,
      portTop: port.getBoundingClientRect().top,
      portHeight: port.clientHeight,
      targetTop: target.getBoundingClientRect().top,
      targetHeight: target.getBoundingClientRect().height,
      maxScrollTop: Math.max(0, port.scrollHeight - port.clientHeight),
    })
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)')
      .matches
      ? 'auto'
      : 'smooth'
    programmaticRef.current = true
    port.scrollTo({ top, behavior })
    programmaticRef.current = false
    port
      .querySelector('[data-quote-target]')
      ?.removeAttribute('data-quote-target')
    target.setAttribute('data-quote-target', 'true')
    window.clearTimeout(quoteHighlightTimer.current)
    quoteHighlightTimer.current = window.setTimeout(() => {
      if (target.isConnected) {
        target.removeAttribute('data-quote-target')
      }
    }, 700)
  }

  function chooseReply(localId: string) {
    const message = useMessageStore.getState().messagesById[localId]
    const current = useChatStore.getState().chatsById[chatId]
    if (message === undefined || current === undefined) {
      return
    }

    const selection = replySelectionFor({
      message,
      activeChatId: chatId,
      contactTitle: chatTitle(current),
      selfName: null,
    })
    if (selection === null) {
      return
    }

    cancelEdit()
    setReply(chatId, selection)
    requestComposerFocus()
  }

  useEffect(() => {
    const element = scrollerRef.current
    const content = contentRef.current
    if (element === null) {
      return
    }

    const sync = () => {
      placeThread(false)
      scheduleFloating()
    }
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    if (content !== null) {
      observer.observe(content)
    }
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', sync)
    viewport?.addEventListener('scroll', sync)
    sync()

    return () => {
      observer.disconnect()
      viewport?.removeEventListener('resize', sync)
      viewport?.removeEventListener('scroll', sync)
      cancelAnimationFrame(floatingFrameRef.current)
      floatingFrameRef.current = 0
      element.scrollTo({ top: element.scrollTop, behavior: 'auto' })
    }
  }, [chatId, placeThread, scheduleFloating])

  function jumpToLatest() {
    const element = scrollerRef.current
    if (element === null) {
      return
    }

    followRef.current = 'bottom'
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)')
      .matches
      ? 'auto'
      : 'smooth'
    jumpingRef.current = behavior === 'smooth'
    programmaticRef.current = true
    element.scrollTo({
      top: element.scrollHeight - element.clientHeight,
      behavior,
    })
    programmaticRef.current = false
    if (behavior === 'auto') {
      jumpingRef.current = false
      publishJump(element)
    }
  }

  return (
    <>
      <div className={styles.transcript}>
        <div
          ref={scrollerRef}
          className={styles.messages}
          role="log"
          aria-label="Сообщения"
          tabIndex={-1}
          aria-busy={phase === 'loading' ? true : undefined}
          onPointerDown={(event) => {
            jumpingRef.current = false
            if (event.target === event.currentTarget) {
              userScrollRef.current = true
            }
          }}
          onWheel={() => {
            userScrollRef.current = true
            jumpingRef.current = false
          }}
          onTouchStart={() => {
            touchScrollTopRef.current = scrollerRef.current?.scrollTop ?? null
          }}
          onTouchMove={() => {
            userScrollRef.current = true
            jumpingRef.current = false
          }}
          onTouchEnd={() => {
            const element = scrollerRef.current
            if (
              element !== null &&
              touchScrollTopRef.current !== null &&
              element.scrollTop === touchScrollTopRef.current
            ) {
              userScrollRef.current = false
            }
            touchScrollTopRef.current = null
          }}
          onKeyDown={(event) => {
            if (isThreadScrollKey(event.key)) {
              userScrollRef.current = true
              jumpingRef.current = false
            }
          }}
          onScrollEnd={() => {
            userScrollRef.current = false
          }}
          onScroll={() => {
            const element = scrollerRef.current
            if (element === null) {
              return
            }

            const distance = distanceFromThreadBottom({
              scrollHeight: element.scrollHeight,
              scrollTop: element.scrollTop,
              clientHeight: element.clientHeight,
            })
            if (programmaticRef.current) {
              return
            }
            if (jumpingRef.current) {
              if (isNearThreadBottom(distance)) {
                jumpingRef.current = false
                followRef.current = 'bottom'
              }
            } else if (userScrollRef.current) {
              followRef.current = nextThreadFollow(
                distance,
                false,
                followRef.current,
                true,
              )
            } else if (
              followRef.current === 'bottom' &&
              distance > 0 &&
              blockedTargetRef.current !==
                bottomScrollTop({
                  clientHeight: element.clientHeight,
                  scrollHeight: element.scrollHeight,
                  scrollTop: element.scrollTop,
                })
            ) {
              placeThread(false)
            }
            publishJump(element)
            scheduleFloating()
            noteScroll()
          }}
        >
          <div ref={contentRef} className={styles.content}>
            {phase === 'ready' ? (
              <div className={styles.historyNote}>
                <Button
                  type="button"
                  className={styles.historyRefresh}
                  onClick={() => {
                    void loadChatHistory(chatId, { refresh: true })
                  }}
                >
                  Обновить
                </Button>
              </div>
            ) : null}
            {phase === 'loading' && ids.length === 0 ? (
              <p className={styles.loading}>
                <Spinner label="Загрузка сообщений" />
              </p>
            ) : null}
            {phase === 'loading' && ids.length > 0 ? (
              <p className={styles.note}>Обновление истории</p>
            ) : null}
            {errorText !== null ? (
              <div className={styles.historyError}>
                <p>{errorText}</p>
                <Button
                  type="button"
                  onClick={() => {
                    void loadChatHistory(chatId, { refresh: true })
                  }}
                >
                  Повторить
                </Button>
              </div>
            ) : null}
            {ids.length === 0 && phase !== 'loading' && phase !== 'error' ? (
              <p className={styles.placeholder}>Сообщений пока нет.</p>
            ) : ids.length > 0 ? (
              <>
                <div className={styles.spacer} />
                {items.map((item) =>
                  item.kind === 'day' ? (
                    <p
                      key={`day:${item.key}`}
                      className={styles.day}
                      data-day={item.key}
                    >
                      <span className={styles.dayLabel}>{item.label}</span>
                    </p>
                  ) : (
                    <MessageActionRow
                      key={item.localId}
                      localId={item.localId}
                      menu={messageMenu}
                      entering={animated.has(item.localId)}
                      contactTitle={contactTitle}
                      now={editNow}
                      onActivateQuote={revealQuote}
                      onRetry={(id, acknowledgeUnknown) => {
                        void retryChatMessage(id, acknowledgeUnknown)
                      }}
                    />
                  ),
                )}
              </>
            ) : null}
          </div>
        </div>
        {floating !== null ? (
          <p
            className={styles.floatingDay}
            data-shown={floating.shown ? 'true' : 'false'}
            aria-hidden="true"
          >
            <span className={styles.dayLabel}>{floating.label}</span>
          </p>
        ) : null}
        {quoteNotice !== '' ? (
          <p className={styles.quoteNotice} role="status">
            {quoteNotice}
          </p>
        ) : null}
        <button
          ref={jumpRef}
          type="button"
          className={styles.jump}
          data-shown={jumpVisible ? 'true' : 'false'}
          tabIndex={jumpVisible ? 0 : -1}
          aria-label="К последним сообщениям"
          aria-hidden={jumpVisible ? undefined : true}
          onClick={jumpToLatest}
        >
          <DownIcon />
        </button>
      </div>
      <MessageMenuOverlay
        menu={messageMenu}
        contactTitle={contactTitle}
        now={editNow}
        onReply={chooseReply}
        onEdit={(localId) => {
          const message = useMessageStore.getState().messagesById[localId]
          const checkedAt = Date.now()
          if (message === undefined || !beginEdit(message, checkedAt)) {
            return
          }
          clearSelection()
          clearReply(message.chatId)
          requestComposerFocus()
        }}
        onForward={onForward}
        onDelete={onDelete}
        onSelect={onSelect}
      />
    </>
  )
}

function dayMarkers(scroller: HTMLElement): DayMarker[] {
  const nodes = scroller.querySelectorAll<HTMLElement>('[data-day]')
  const markers: DayMarker[] = []
  for (const node of nodes) {
    const box = node.getBoundingClientRect()
    const label = node.querySelector('span')?.textContent?.trim() ?? ''
    if (label === '') {
      continue
    }
    markers.push({
      label,
      separatorTop: box.top,
      separatorBottom: box.bottom,
    })
  }
  return markers
}

function DownIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4 8l6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M12 4 6 10l6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
