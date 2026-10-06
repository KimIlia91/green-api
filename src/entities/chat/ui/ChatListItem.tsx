import type { ReactNode } from 'react'

import { chatInitials, chatTitle } from '../model/chat-title.ts'
import { formatChatActivityTime } from '../model/chat-time.ts'
import { useChatStore } from '../model/chat.store.ts'
import { selectChatById } from '../model/chat.selectors.ts'
import styles from './ChatListItem.module.css'

type ChatListItemProps = {
  chatId: string
  selected: boolean
  onSelect: (chatId: string) => void
  previewStatus?: ReactNode
}

export function ChatListItem({
  chatId,
  selected,
  onSelect,
  previewStatus = null,
}: ChatListItemProps) {
  const chat = useChatStore(selectChatById(chatId))
  if (!chat) {
    return null
  }

  return (
    <button
      type="button"
      className={styles.item}
      data-chat-id={chat.chatId}
      aria-current={selected ? 'true' : undefined}
      onClick={() => {
        onSelect(chat.chatId)
      }}
    >
      <span className={styles.avatar} aria-hidden="true">
        {chatInitials(chat)}
        {chat.unseenIncomingIds.length > 0 ? (
          <span className={styles.unseen} />
        ) : null}
      </span>
      <span className={styles.body}>
        <span className={styles.topline}>
          <span className={styles.name}>{chatTitle(chat)}</span>
          {chat.lastActivityAt !== null ? (
            <time
              className={styles.time}
              dateTime={new Date(chat.lastActivityAt).toISOString()}
            >
              {formatChatActivityTime(chat.lastActivityAt)}
            </time>
          ) : null}
        </span>
        {chat.preview !== null && chat.preview !== '' ? (
          <span className={styles.previewLine}>
            {previewStatus !== null ? (
              <span className={styles.previewStatus}>{previewStatus}</span>
            ) : null}
            {chat.previewForwarded ? (
              <>
                <svg
                  className={styles.forwardMark}
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <path
                    d="M9.2 3.6 12.6 7 9.2 10.4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M12.2 7H6.4A2.4 2.4 0 0 0 4 9.4V12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                <span className={styles.forwardedText}>
                  Пересланное сообщение
                </span>
              </>
            ) : null}
            <span className={styles.preview}>{chat.preview}</span>
          </span>
        ) : null}
      </span>
      {chat.unseenIncomingIds.length > 0 ? (
        <span className={styles.unseenText}>Есть новые сообщения</span>
      ) : null}
    </button>
  )
}
