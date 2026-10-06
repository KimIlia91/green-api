import {
  chatInitials,
  chatTitle,
  selectChatById,
  selectChatIds,
  useChatStore,
} from '@/entities/chat'

import styles from './ForwardTargetList.module.css'

export function ForwardTargetList({
  pending,
  confirm,
  onCancel,
  onPick,
  onConfirm,
}: {
  pending: boolean
  confirm?: { chatId: string; message: string } | null
  onCancel: () => void
  onPick: (chatId: string) => void
  onConfirm?: () => void
}) {
  const ids = useChatStore(selectChatIds)

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.cancel}
          onClick={onCancel}
          disabled={pending}
        >
          Отмена
        </button>
        <p className={styles.title}>Переслать</p>
      </div>
      {confirm ? (
        <div className={styles.confirm}>
          <p className={styles.confirmText}>{confirm.message}</p>
          <button
            type="button"
            className={styles.confirmAction}
            disabled={pending}
            onClick={onConfirm}
          >
            Переслать ещё раз
          </button>
        </div>
      ) : null}
      <ul className={styles.list}>
        {ids.map((chatId) => (
          <TargetRow
            key={chatId}
            chatId={chatId}
            pending={pending}
            onPick={onPick}
          />
        ))}
      </ul>
    </div>
  )
}

function TargetRow({
  chatId,
  pending,
  onPick,
}: {
  chatId: string
  pending: boolean
  onPick: (chatId: string) => void
}) {
  const chat = useChatStore(selectChatById(chatId))
  if (chat === undefined) {
    return null
  }

  const title = chatTitle(chat)

  return (
    <li>
      <button
        type="button"
        className={styles.chat}
        disabled={pending}
        onClick={() => {
          onPick(chatId)
        }}
      >
        <span className={styles.avatar} aria-hidden="true">
          {chatInitials(chat)}
        </span>
        <span className={styles.name}>{title}</span>
      </button>
    </li>
  )
}
