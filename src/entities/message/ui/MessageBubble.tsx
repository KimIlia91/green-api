import {
  useState,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type Ref,
} from 'react'

import { Button } from '@/shared/ui'

import { unknownRetryWarning } from '../model/message-copy.ts'
import { formatMessageTime } from '../model/message-time.ts'
import { selectMessageById } from '../model/message.selectors.ts'
import { useMessageStore } from '../model/message.store.ts'
import { presentQuote, quoteOriginal } from '../model/quote.ts'
import styles from './MessageBubble.module.css'
import { OutgoingStatus } from './OutgoingStatus.tsx'

type MessageBubbleProps = {
  localId: string
  entering?: boolean
  onRetry?: (localId: string, acknowledgeUnknown: boolean) => void
  actions?: ReactNode
  surfaceRef?: Ref<HTMLDivElement>
  tabIndex?: number
  onContextMenu?: MouseEventHandler<HTMLDivElement>
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerMove?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
  onPointerCancel?: PointerEventHandler<HTMLDivElement>
  contactTitle?: string
  onActivateQuote?: (sourceId: string) => void
  selecting?: boolean
  selectable?: boolean
  selected?: boolean
  onToggleSelected?: () => void
}

export function MessageBubble({
  localId,
  entering = false,
  onRetry,
  actions,
  surfaceRef,
  tabIndex,
  onContextMenu,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  contactTitle = '',
  onActivateQuote,
  selecting = false,
  selectable = false,
  selected = false,
  onToggleSelected,
}: MessageBubbleProps) {
  const message = useMessageStore(selectMessageById(localId))
  const original = useMessageStore((state) => quoteOriginal(state, message))
  const [confirming, setConfirming] = useState(false)

  if (!message) {
    return null
  }

  const outgoing = message.direction === 'outgoing'
  const quoteView =
    message.quote === undefined || message.quote === null
      ? null
      : presentQuote({
          quote: message.quote,
          original,
          contactTitle,
          selfName: null,
        })
  const stickerUrl = message.stickerUrl
  const showSticker = stickerUrl !== null
  const body = message.text

  const canToggle = selecting && selectable

  return (
    <div
      className={
        selecting
          ? `${outgoing ? styles.outgoing : styles.incoming} ${styles.selecting}`
          : outgoing
            ? styles.outgoing
            : styles.incoming
      }
      data-provider-id={message.providerId ?? undefined}
      data-selecting={selecting ? 'true' : undefined}
      role={canToggle ? 'button' : undefined}
      tabIndex={canToggle ? 0 : undefined}
      aria-pressed={canToggle ? selected : undefined}
      onClick={
        canToggle
          ? () => {
              onToggleSelected?.()
            }
          : undefined
      }
      onKeyDown={
        canToggle
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') {
                return
              }
              event.preventDefault()
              onToggleSelected?.()
            }
          : undefined
      }
      onContextMenu={selecting ? onContextMenu : undefined}
    >
      {canToggle ? (
        <span
          className={styles.mark}
          data-selected={selected ? 'true' : 'false'}
          aria-hidden="true"
        >
          {selected ? <CheckIcon /> : null}
        </span>
      ) : null}
      <div
        ref={surfaceRef}
        className={styles.bundle}
        tabIndex={selecting ? undefined : tabIndex}
        data-message-surface=""
        onContextMenu={selecting ? undefined : onContextMenu}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {actions ? <div className={styles.actions}>{actions}</div> : null}
        <div className={entering ? styles.entering : undefined}>
          {showSticker ? (
            <div className={styles.stickerFrame}>
              {isVideoSticker(message.stickerMimeType) ? (
                <video
                  className={styles.sticker}
                  src={stickerUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  aria-label="Стикер"
                />
              ) : (
                <img className={styles.sticker} src={stickerUrl} alt="Стикер" />
              )}
              {message.text !== '' ? (
                <p className={styles.caption}>{message.text}</p>
              ) : null}
              <p className={`${styles.meta} ${styles.stickerMeta}`}>
                {message.forwarded === true ? <ForwardMark /> : null}
                <time dateTime={new Date(message.createdAt).toISOString()}>
                  {formatMessageTime(message.createdAt)}
                </time>
                {outgoing && message.sendState ? (
                  <OutgoingStatus state={message.sendState} />
                ) : null}
              </p>
            </div>
          ) : (
            <div
              className={
                outgoing ? styles.outgoingBubble : styles.incomingBubble
              }
            >
              {message.quote && quoteView ? (
                <QuoteBlock
                  sourceId={message.quote.sourceId}
                  author={quoteView.author}
                  excerpt={quoteView.excerpt}
                  onActivate={selecting ? undefined : onActivateQuote}
                />
              ) : null}
              <p className={styles.text}>{body}</p>
              <p className={styles.meta}>
                {message.forwarded === true ? <ForwardMark /> : null}
                {message.edited === true ? (
                  <span className={styles.editedNote}>изменено</span>
                ) : null}
                <time dateTime={new Date(message.createdAt).toISOString()}>
                  {formatMessageTime(message.createdAt)}
                </time>
                {outgoing && message.sendState ? (
                  <OutgoingStatus state={message.sendState} />
                ) : null}
              </p>
              {!selecting && outgoing && message.sendState === 'failed' ? (
                <Button
                  type="button"
                  className={styles.retry}
                  onClick={() => {
                    onRetry?.(localId, false)
                  }}
                >
                  Повторить
                </Button>
              ) : null}
              {!selecting &&
              outgoing &&
              message.sendState === 'unknown' &&
              !confirming ? (
                <Button
                  type="button"
                  className={styles.retry}
                  onClick={() => {
                    setConfirming(true)
                  }}
                >
                  Повторить
                </Button>
              ) : null}
              {!selecting &&
              outgoing &&
              message.sendState === 'unknown' &&
              confirming ? (
                <div className={styles.confirm}>
                  <p>{unknownRetryWarning}</p>
                  <Button
                    type="button"
                    className={styles.retry}
                    onClick={() => {
                      setConfirming(false)
                      onRetry?.(localId, true)
                    }}
                  >
                    Отправить ещё раз
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.2 6.4 11.1 12.5 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function QuoteBlock({
  sourceId,
  author,
  excerpt,
  onActivate,
}: {
  sourceId: string
  author: string | null
  excerpt: string
  onActivate?: (sourceId: string) => void
}) {
  const label = author === null ? excerpt : `Цитата ${author}: ${excerpt}`
  const body = (
    <>
      {author !== null ? (
        <span className={styles.quoteAuthor}>{author}</span>
      ) : null}
      <span className={styles.quoteExcerpt}>{excerpt}</span>
    </>
  )

  if (onActivate === undefined) {
    return (
      <div className={styles.quote} data-quote-source={sourceId}>
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={styles.quote}
      data-quote-source={sourceId}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onActivate(sourceId)
      }}
    >
      {body}
    </button>
  )
}

function ForwardMark() {
  return (
    <span className={styles.forwardMark}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
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
      <span className={styles.forwardedText}>Пересланное сообщение</span>
    </span>
  )
}

function isVideoSticker(mimeType: string | null): boolean {
  return mimeType?.toLowerCase().startsWith('video/') ?? false
}
