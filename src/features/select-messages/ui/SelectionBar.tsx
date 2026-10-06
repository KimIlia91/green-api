import styles from './SelectionBar.module.css'

export function SelectionBar({
  count,
  reason,
  pending,
  deleteDisabled,
  forwardDisabled,
  onCancel,
  onDelete,
  onForward,
}: {
  count: number
  reason: string
  pending: boolean
  deleteDisabled: boolean
  forwardDisabled: boolean
  onCancel: () => void
  onDelete: () => void
  onForward: () => void
}) {
  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.cancel}
          aria-label="Отменить выбор"
          onClick={onCancel}
        >
          <CloseIcon />
        </button>
        <p className={styles.count}>Выбрано {String(count)}</p>
        <button
          type="button"
          className={styles.action}
          disabled={pending || deleteDisabled || count === 0}
          onClick={onDelete}
        >
          Удалить
        </button>
        <button
          type="button"
          className={styles.action}
          disabled={pending || forwardDisabled || count === 0}
          onClick={onForward}
        >
          Переслать
        </button>
      </div>
      {reason !== '' ? (
        <p className={styles.reason} role="status">
          {reason}
        </p>
      ) : null}
    </div>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
