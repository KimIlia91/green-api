import { useEffect, useRef, useState } from 'react'

import {
  ChatListItem,
  chatTitle,
  useChatStore,
  selectChatIds,
  selectChatsById,
} from '@/entities/chat'
import {
  OutgoingStatus,
  selectLatestOutgoingState,
  useMessageStore,
} from '@/entities/message'
import {
  loadChatList,
  selectChatListError,
  selectChatListStatus,
  useLoadChatsStore,
} from '@/features/load-chats'
import {
  chatPreviewErrorMessage,
  loadChatPreviews,
  retryFailedChatPreviews,
  selectChatPreviewFailed,
  useChatPreviewStore,
} from '@/features/load-chat-previews'
import { Button, IconButton, Input, Spinner } from '@/shared/ui'

import { closeFocusTarget } from '../model/close-focus.ts'
import styles from './ChatSidebar.module.css'

type ChatSidebarProps = {
  selectedChatId: string | null
  onCreateChat: () => void
  onChatChosen: (chatId: string) => void
  onLeave: () => void
}

export function ChatSidebar({
  selectedChatId,
  onCreateChat,
  onChatChosen,
  onLeave,
}: ChatSidebarProps) {
  const chatIds = useChatStore(selectChatIds)
  const chatsById = useChatStore(selectChatsById)
  const listStatus = useLoadChatsStore(selectChatListStatus)
  const listError = useLoadChatsStore(selectChatListError)
  const previewFailed = useChatPreviewStore(selectChatPreviewFailed)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const visibleIds =
    normalizedQuery === ''
      ? chatIds
      : chatIds.filter((chatId) => {
          const chat = chatsById[chatId]
          if (chat === undefined) {
            return false
          }

          return (
            chatTitle(chat).toLowerCase().includes(normalizedQuery) ||
            (chat.phoneNumber?.includes(normalizedQuery) ?? false)
          )
        })
  const visibleKey = visibleIds.join('\n')
  const previousChatId = useRef(selectedChatId)

  useEffect(() => {
    const previous = previousChatId.current
    previousChatId.current = selectedChatId
    if (previous === null || selectedChatId !== null) {
      return
    }

    const row = document.querySelector<HTMLElement>(
      `[data-chat-id="${CSS.escape(previous)}"]`,
    )
    const rowAvailable = row !== null && row.getClientRects().length > 0
    if (closeFocusTarget(rowAvailable) === 'row') {
      row?.focus()
      return
    }

    document.getElementById('chat-list-title')?.focus()
  }, [selectedChatId])

  useEffect(() => {
    if (listStatus !== 'ready') {
      return
    }

    loadChatPreviews(visibleKey === '' ? [] : visibleKey.split('\n'))
  }, [listStatus, visibleKey])

  return (
    <div className={styles.sidebar}>
      <nav className={styles.rail} aria-label="Разделы">
        <button type="button" className={styles.railButton} aria-current="page">
          <ChatsIcon />
          <span>Чаты</span>
        </button>
        <button type="button" className={styles.railButton} onClick={onLeave}>
          <LogoutIcon />
          <span>Выйти</span>
        </button>
      </nav>
      <section className={styles.list} aria-labelledby="chat-list-title">
        <header className={styles.header}>
          <h1 id="chat-list-title" className={styles.title} tabIndex={-1}>
            Чаты
          </h1>
          <IconButton
            label="Новый чат"
            className={styles.addButton}
            onClick={onCreateChat}
          >
            <PlusIcon />
          </IconButton>
        </header>
        <div className={styles.search}>
          <Input
            label="Поиск"
            name="chat-search"
            value={query}
            placeholder="Найти"
            autoComplete="off"
            spellCheck={false}
            className={styles.searchInput}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
        </div>
        {listStatus === 'loading' && chatIds.length === 0 ? (
          <p className={styles.loading}>
            <Spinner label="Загрузка чатов" />
          </p>
        ) : null}
        {previewFailed ? (
          <div className={styles.notice}>
            <p>{chatPreviewErrorMessage}</p>
            <Button
              type="button"
              onClick={() => {
                retryFailedChatPreviews()
              }}
            >
              Повторить
            </Button>
          </div>
        ) : null}
        {listError !== null ? (
          <div className={styles.notice}>
            <p>{listError}</p>
            <Button
              type="button"
              onClick={() => {
                void loadChatList()
              }}
            >
              Повторить
            </Button>
          </div>
        ) : null}
        {chatIds.length === 0 && listStatus === 'ready' ? (
          <p className={styles.empty}>
            Чатов пока нет. Создайте чат по номеру телефона.
          </p>
        ) : null}
        {chatIds.length > 0 && visibleIds.length === 0 ? (
          <p className={styles.empty}>Ничего не найдено.</p>
        ) : null}
        {visibleIds.length > 0 ? (
          <ul className={styles.items}>
            {visibleIds.map((chatId) => (
              <li key={chatId}>
                <ChatListRow
                  chatId={chatId}
                  selected={chatId === selectedChatId}
                  onSelect={onChatChosen}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}

function ChatListRow({
  chatId,
  selected,
  onSelect,
}: {
  chatId: string
  selected: boolean
  onSelect: (chatId: string) => void
}) {
  const outgoingState = useMessageStore(selectLatestOutgoingState(chatId))

  return (
    <ChatListItem
      chatId={chatId}
      selected={selected}
      onSelect={onSelect}
      previewStatus={
        outgoingState === null ? null : <OutgoingStatus state={outgoingState} />
      }
    />
  )
}

function ChatsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 6.5h10.5A2.5 2.5 0 0 1 18 9v5.2a2.5 2.5 0 0 1-2.5 2.5H10l-3.2 2.4V16.7H5A2.5 2.5 0 0 1 2.5 14.2V9A2.5 2.5 0 0 1 5 6.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 3.25v9.5M3.25 8h9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10 7V5.8A1.8 1.8 0 0 1 11.8 4h6.4A1.8 1.8 0 0 1 20 5.8v12.4a1.8 1.8 0 0 1-1.8 1.8h-6.4A1.8 1.8 0 0 1 10 18.2V17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M4 12h9M10 8.5 13.5 12 10 15.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
