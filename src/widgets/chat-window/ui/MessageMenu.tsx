import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type PointerEventHandler,
} from 'react'
import { createPortal } from 'react-dom'

import {
  MessageBubble,
  selectMessageById,
  useMessageStore,
} from '@/entities/message'
import { copyFailureText, copySuccessText } from '@/features/copy-message-text'
import { toggleSelection, useSelectionStore } from '@/features/select-messages'
import { usePortalNode } from '@/shared/ui'

import {
  holdMoved,
  longPressDelayMs,
  shouldOpenHold,
  type PointerHold,
} from '../model/long-press.ts'
import { useHidesMessageActionButton } from '../model/message-actions.ts'
import { messageMenuActions } from '../model/message-menu-actions.ts'
import {
  placeMessageMenu,
  type MenuAnchor,
  type MenuPlacement,
} from '../model/place-menu.ts'
import { type MessageMenuController } from '../model/useMessageMenu.ts'
import styles from './MessageMenu.module.css'

const menuMarginPx = 8
const menuGapPx = 8
export function MessageActionRow({
  localId,
  menu,
  entering,
  onRetry,
  contactTitle,
  now,
  onActivateQuote,
}: {
  localId: string
  menu: MessageMenuController
  entering: boolean
  onRetry: (localId: string, acknowledgeUnknown: boolean) => void
  contactTitle: string
  now: number
  onActivateQuote: (sourceId: string) => void
}) {
  const message = useMessageStore(selectMessageById(localId))
  const actions =
    message === undefined
      ? []
      : messageMenuActions(message, {
          activeChatId: menu.chatId,
          contactTitle,
          now,
        })
  const canSelect = actions.includes('select')
  const selectionChatId = useSelectionStore((state) => state.chatId)
  const selectedIds = useSelectionStore((state) => state.localIds)
  const selecting = selectionChatId === menu.chatId
  const selected = selectedIds.includes(localId)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const holdRef = useRef<PointerHold | null>(null)
  const movedRef = useRef(false)
  const timerRef = useRef(0)
  const chatRef = useRef(menu.chatId)
  const hidesActions = useHidesMessageActionButton()

  useEffect(() => {
    chatRef.current = menu.chatId
    return () => {
      chatRef.current = ''
      window.clearTimeout(timerRef.current)
      holdRef.current = null
    }
  }, [menu.chatId])

  if (actions.length === 0) {
    return (
      <MessageBubble
        localId={localId}
        entering={entering}
        onRetry={selecting ? undefined : onRetry}
        contactTitle={contactTitle}
        onActivateQuote={selecting ? undefined : onActivateQuote}
        selecting={selecting}
        selectable={false}
      />
    )
  }

  const open =
    menu.session?.localId === localId && menu.session.phase === 'open'

  const clearHold = () => {
    window.clearTimeout(timerRef.current)
    holdRef.current = null
  }

  const focusTarget = (): HTMLElement | null =>
    hidesActions ? surfaceRef.current : triggerRef.current

  const onContextMenu: MouseEventHandler<HTMLDivElement> = (event) => {
    if (selecting) {
      event.preventDefault()
      if (canSelect) {
        toggleSelection(menu.chatId, localId)
      }
      return
    }
    if (isLink(event.target)) {
      return
    }
    event.preventDefault()
    const active = document.activeElement
    const keyboard =
      event.button !== 2 &&
      active instanceof HTMLElement &&
      event.currentTarget.contains(active)
    menu.openMenu(
      localId,
      keyboard
        ? elementAnchor(active)
        : pointAnchor(event.clientX, event.clientY),
      focusTarget(),
    )
  }

  const onPointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    if (selecting) {
      return
    }
    if (event.button !== 0 || event.pointerType === 'mouse') {
      return
    }
    if (isLink(event.target) || isTrigger(event.target)) {
      return
    }

    const next = { chatId: menu.chatId, x: event.clientX, y: event.clientY }
    holdRef.current = next
    movedRef.current = false
    const epoch = menu.scrollEpoch.current
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      if (movedRef.current || menu.scrollEpoch.current !== epoch) {
        return
      }
      if (!shouldOpenHold(holdRef.current, chatRef.current, false)) {
        return
      }
      menu.armSuppress()
      menu.openMenu(localId, pointAnchor(next.x, next.y), focusTarget())
      holdRef.current = null
    }, longPressDelayMs)
  }

  const onPointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
    const hold = holdRef.current
    if (hold === null || !holdMoved(hold, event.clientX, event.clientY)) {
      return
    }
    movedRef.current = true
    clearHold()
  }

  const onPointerUp: PointerEventHandler<HTMLDivElement> = () => {
    clearHold()
  }

  const onPointerCancel: PointerEventHandler<HTMLDivElement> = () => {
    const pending = holdRef.current !== null
    movedRef.current = true
    clearHold()
    if (pending) {
      menu.clearSuppress()
    }
  }

  return (
    <MessageBubble
      localId={localId}
      entering={entering}
      surfaceRef={surfaceRef}
      tabIndex={hidesActions ? 0 : undefined}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      contactTitle={contactTitle}
      onActivateQuote={selecting ? undefined : onActivateQuote}
      onRetry={selecting ? undefined : onRetry}
      selecting={selecting}
      selectable={canSelect}
      selected={selected}
      onToggleSelected={() => {
        toggleSelection(menu.chatId, localId)
      }}
      actions={
        selecting ? undefined : (
          <button
            ref={triggerRef}
            type="button"
            className={styles.trigger}
            data-message-trigger={localId}
            data-menu-open={open ? 'true' : 'false'}
            tabIndex={hidesActions ? -1 : 0}
            aria-label="Действия сообщения"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menu.menuId : undefined}
            onClick={() => {
              if (menu.peekSuppress()) {
                return
              }
              const trigger = triggerRef.current
              if (trigger === null) {
                return
              }
              if (open) {
                menu.closeMenu('outside')
                return
              }
              menu.openMenu(localId, elementAnchor(trigger), focusTarget())
            }}
          >
            <DotsIcon />
          </button>
        )
      }
    />
  )
}

export function MessageMenuOverlay({
  menu,
  contactTitle,
  now,
  onReply,
  onEdit,
  onForward,
  onDelete,
  onSelect,
}: {
  menu: MessageMenuController
  contactTitle: string
  now: number
  onReply: (localId: string) => void
  onEdit: (localId: string) => void
  onForward: (localId: string) => void
  onDelete: (localId: string) => void
  onSelect: (localId: string) => void
}) {
  const portal = usePortalNode()
  const itemRef = useRef<HTMLButtonElement>(null)
  const [placement, setPlacement] = useState<{
    id: number
    value: MenuPlacement
  } | null>(null)
  const menuNodeRef = useRef<HTMLDivElement>(null)
  const session = menu.session
  const quoted = useMessageStore(selectMessageById(session?.localId ?? ''))
  const actions =
    quoted === undefined
      ? []
      : messageMenuActions(quoted, {
          activeChatId: menu.chatId,
          contactTitle,
          now,
        })
  const firstAction = actions[0]
  const actionKey = actions.join(',')
  const placed =
    placement !== null && placement.id === session?.id ? placement.value : null

  useLayoutEffect(() => {
    const current = menu.session
    const element = menuNodeRef.current
    if (current === null || element === null) {
      return
    }
    const box = element.getBoundingClientRect()
    setPlacement({
      id: current.id,
      value: placeMessageMenu(
        current.anchor,
        box.width,
        box.height,
        window.innerWidth,
        window.innerHeight,
        menuMarginPx,
        menuGapPx,
      ),
    })
  }, [actionKey, menu.session])

  useLayoutEffect(() => {
    if (menu.session?.phase !== 'open' || placed === null) {
      return
    }
    itemRef.current?.focus({ preventScroll: true })
  }, [menu.session?.id, menu.session?.phase, placed])

  if (portal === null) {
    return null
  }

  const notice = menu.notice

  return createPortal(
    <>
      {session !== null && actions.length > 0 ? (
        <div
          ref={menuNodeRef}
          id={menu.menuId}
          className={styles.menu}
          role="menu"
          aria-label="Действия сообщения"
          data-message-menu=""
          data-placed={placed !== null ? 'true' : 'false'}
          data-phase={session.phase}
          data-placement={placed?.placement ?? 'below'}
          style={
            placed === null ? undefined : { top: placed.top, left: placed.left }
          }
          inert={session.phase !== 'open'}
          aria-hidden={session.phase === 'open' ? undefined : true}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              menu.closeMenu('escape')
              return
            }
            if (
              event.key === 'ArrowDown' ||
              event.key === 'ArrowUp' ||
              event.key === 'Home' ||
              event.key === 'End'
            ) {
              event.preventDefault()
              moveMenuItem(event.currentTarget, event.key)
              return
            }
            if (event.key === 'Tab') {
              menu.closeMenu('outside')
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault()
          }}
        >
          {actions.includes('reply') ? (
            <button
              ref={firstAction === 'reply' ? itemRef : undefined}
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                if (menu.peekSuppress()) {
                  return
                }
                menu.closeMenu('outside')
                onReply(session.localId)
              }}
            >
              <ReplyIcon />
              Ответить
            </button>
          ) : null}
          {actions.includes('edit') ? (
            <button
              ref={firstAction === 'edit' ? itemRef : undefined}
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                if (menu.peekSuppress()) {
                  return
                }
                menu.closeMenu('outside')
                onEdit(session.localId)
              }}
            >
              <EditIcon />
              Редактировать
            </button>
          ) : null}
          {actions.includes('copy') ? (
            <button
              ref={firstAction === 'copy' ? itemRef : undefined}
              type="button"
              role="menuitem"
              className={styles.item}
              aria-disabled={menu.pending ? true : undefined}
              onClick={() => {
                if (menu.peekSuppress() || menu.pending) {
                  return
                }
                menu.copyText(session.localId)
              }}
            >
              <CopyIcon />
              Скопировать текст
            </button>
          ) : null}
          {actions.includes('forward') ? (
            <button
              ref={firstAction === 'forward' ? itemRef : undefined}
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                if (menu.peekSuppress()) {
                  return
                }
                menu.closeMenu('outside')
                onForward(session.localId)
              }}
            >
              <ForwardIcon />
              Переслать
            </button>
          ) : null}
          {actions.includes('delete') ? (
            <button
              ref={firstAction === 'delete' ? itemRef : undefined}
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                if (menu.peekSuppress()) {
                  return
                }
                menu.closeMenu('outside')
                onDelete(session.localId)
              }}
            >
              <DeleteIcon />
              Удалить
            </button>
          ) : null}
          {actions.includes('select') ? (
            <button
              ref={firstAction === 'select' ? itemRef : undefined}
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                if (menu.peekSuppress()) {
                  return
                }
                menu.closeMenu('outside')
                onSelect(session.localId)
              }}
            >
              <SelectIcon />
              Выбрать
            </button>
          ) : null}
        </div>
      ) : null}
      {notice !== null ? (
        <div
          className={styles.notice}
          data-phase={notice.phase}
          aria-hidden="true"
        >
          <p>{notice.kind === 'copied' ? copySuccessText : copyFailureText}</p>
        </div>
      ) : null}
      <div className={styles.live} role="status" aria-live="polite">
        {menu.live.polite}
      </div>
      <div className={styles.live} role="alert" aria-live="assertive">
        {menu.live.assertive}
      </div>
    </>,
    portal,
  )
}

function elementAnchor(element: HTMLElement): MenuAnchor {
  const box = element.getBoundingClientRect()
  return {
    top: box.top,
    right: box.right,
    bottom: box.bottom,
    left: box.left,
  }
}

function pointAnchor(x: number, y: number): MenuAnchor {
  return { top: y, right: x, bottom: y, left: x }
}

function isLink(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('a') !== null
}

function isTrigger(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-message-trigger]') !== null
  )
}

function moveMenuItem(menu: HTMLDivElement, key: string): void {
  const items = [
    ...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ]
  if (items.length === 0) {
    return
  }

  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  if (key === 'Home') {
    items[0]?.focus({ preventScroll: true })
    return
  }
  if (key === 'End') {
    items[items.length - 1]?.focus({ preventScroll: true })
    return
  }

  const step = key === 'ArrowDown' ? 1 : -1
  const next = current < 0 ? 0 : (current + step + items.length) % items.length
  items[next]?.focus({ preventScroll: true })
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M7.5 6.5 4 10l3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 10H12a3.5 3.5 0 0 1 3.5 3.5V15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="4.5" r="1.4" fill="currentColor" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" />
      <circle cx="10" cy="15.5" r="1.4" fill="currentColor" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M12.2 4.8 15.2 7.8 7.5 15.5H4.5V12.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M11 6 14 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ForwardIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M12.5 6.5 16 10l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 10H8A3.5 3.5 0 0 0 4.5 13.5V15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M5.5 7.5h9M8 7.4V5.8h4v1.6M7.2 7.5l.5 7.2h4.6l.5-7.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SelectIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle
        cx="10"
        cy="10"
        r="6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M7.2 10.2 9.1 12.1 12.9 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect
        x="7"
        y="7"
        width="9"
        height="9"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M5 13V5.5A1.5 1.5 0 0 1 6.5 4H13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
