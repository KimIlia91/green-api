import type { OutgoingSendState } from '../model/message.types.ts'
import styles from './OutgoingStatus.module.css'

type OutgoingStatusProps = {
  state: OutgoingSendState
}

const labels = {
  sending: 'Отправка',
  queued: 'В очереди',
  sent: 'Отправлено',
  delivered: 'Доставлено',
  read: 'Прочитано',
  failed: 'Не отправлено',
  unknown: 'Результат отправки неизвестен',
} satisfies Record<OutgoingSendState, string>

export function OutgoingStatus({ state }: OutgoingStatusProps) {
  const label = labels[state]

  return (
    <span
      className={state === 'failed' ? styles.failed : styles.status}
      title={label}
    >
      <StatusIcon state={state} />
      <span className={styles.visuallyHidden}>{label}</span>
    </span>
  )
}

function StatusIcon({ state }: OutgoingStatusProps) {
  if (state === 'sending') {
    return (
      <svg className={styles.sending} viewBox="0 0 16 16" aria-hidden="true">
        <circle
          cx="8"
          cy="8"
          r="5.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="10 23"
        />
      </svg>
    )
  }

  if (state === 'queued') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle
          cx="8"
          cy="8"
          r="5.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M8 4.8 V8.15 L10.25 9.55"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (state === 'sent') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M4.2 11.8 12 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M6.6 4 H12 V9.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (state === 'delivered') {
    return <CheckIcon />
  }

  if (state === 'read') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M1.5 8.5 4.1 11.1 8 5.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6.1 8.6 8.6 11.1 14.4 4.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (state === 'failed') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle
          cx="8"
          cy="8"
          r="5.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M8 5 V8.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <circle cx="8" cy="10.9" r="0.7" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="5.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M6.15 6.35 a1.9 1.9 0 1 1 2.55 1.75 c-.55.35-.75.65-.75 1.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.25" r="0.65" fill="currentColor" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.2 8.3 6.4 11.4 12.8 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
