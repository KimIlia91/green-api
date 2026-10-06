import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type TransitionEvent,
} from 'react'

import { selectActiveChat, useChatStore } from '@/entities/chat'
import type { ReplySelection } from '@/entities/message'
import { IconButton, Textarea } from '@/shared/ui'

import { subscribeComposerFocus } from '../model/composer-focus.ts'
import {
  clearReply,
  selectDraft,
  selectReply,
  setDraft,
  useDraftStore,
} from '../model/drafts.ts'
import { messageTextIssue, messageTextMessage } from '../model/message-text.ts'
import { composerPreviewLine } from '../model/preview-line.ts'
import { sendChatMessage } from '../model/send-message.ts'
import { shouldSubmitOnEnter } from '../model/submit-key.ts'
import styles from './MessageComposer.module.css'

type EditingField = {
  text: string
  preview: string
  notice: string
  onText: (text: string) => void
  onCancel: () => void
  onSave: () => void
}

type ComposerBanner =
  | { kind: 'reply'; selection: ReplySelection }
  | { kind: 'edit'; preview: string }

export function MessageComposer({
  editing = null,
}: {
  editing?: EditingField | null
}) {
  const chat = useChatStore(selectActiveChat)
  const chatId = chat?.chatId ?? ''
  const draft = useDraftStore(selectDraft(chatId))
  const reply = useDraftStore(selectReply(chatId))
  const banner =
    editing !== null
      ? ({ kind: 'edit', preview: editing.preview } satisfies ComposerBanner)
      : reply !== null
        ? ({ kind: 'reply', selection: reply } satisfies ComposerBanner)
        : null
  const [heldChat, setHeldChat] = useState(chatId)
  const [held, setHeld] = useState<ComposerBanner | null>(banner)
  if (heldChat !== chatId) {
    setHeldChat(chatId)
    setHeld(banner)
  } else if (banner !== null && !sameBanner(held, banner)) {
    setHeld(banner)
  } else if (
    banner === null &&
    held !== null &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    setHeld(null)
  }
  const panel = banner ?? held
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fieldText = editing === null ? draft : editing.text
  const issue = messageTextIssue(fieldText)
  const limitMessage = issue === 'too-long' ? messageTextMessage(issue) : ''

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (element === null) {
      return
    }

    element.style.height = 'auto'
    element.style.height = `${String(element.scrollHeight)}px`
  }, [fieldText])

  useEffect(
    () =>
      subscribeComposerFocus(() => {
        textareaRef.current?.focus({ preventScroll: true })
      }),
    [],
  )

  if (!chat) {
    return null
  }

  async function submit() {
    if (pending.current) {
      return
    }

    if (editing !== null) {
      editing.onSave()
      return
    }

    pending.current = true
    setBusy(true)
    try {
      const outcome = await sendChatMessage(chatId, draft)
      if (outcome.status === 'invalid') {
        setNotice(outcome.message)
      }
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      !shouldSubmitOnEnter({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
        keyCode: event.keyCode,
      })
    ) {
      return
    }

    event.preventDefault()
    void submit()
  }

  function cancelBanner() {
    if (panel?.kind === 'edit') {
      editing?.onCancel()
    } else if (panel?.kind === 'reply') {
      clearReply(chatId)
    }
    textareaRef.current?.focus({ preventScroll: true })
  }

  function onBannerTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (
      event.propertyName !== 'grid-template-rows' ||
      editing !== null ||
      reply !== null
    ) {
      return
    }

    setHeld(null)
  }

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      <div
        className={styles.replySlot}
        data-open={banner !== null ? 'true' : 'false'}
        onTransitionEnd={onBannerTransitionEnd}
      >
        <div className={styles.replyClip}>
          {panel !== null ? (
            <div className={styles.reply}>
              {panel.kind === 'edit' ? <PencilIcon /> : <ReplyIcon />}
              <div className={styles.replyBody}>
                <p className={styles.replyTitle}>
                  {panel.kind === 'edit'
                    ? 'Редактирование сообщения'
                    : panel.selection.composerLabel}
                </p>
                <p className={styles.replyExcerpt}>
                  {composerPreviewLine(
                    panel.kind === 'edit'
                      ? panel.preview
                      : panel.selection.excerpt,
                  )}
                </p>
              </div>
              <button
                type="button"
                className={styles.cancel}
                aria-label={
                  panel.kind === 'edit'
                    ? 'Отменить редактирование'
                    : 'Отменить ответ'
                }
                onClick={cancelBanner}
              >
                <CloseIcon />
              </button>
              <div className={styles.replyDivider} />
            </div>
          ) : null}
        </div>
      </div>
      <div className={styles.row}>
        <Textarea
          label="Сообщение"
          labelHidden
          name="message"
          placeholder="Сообщение"
          rows={1}
          value={fieldText}
          ref={textareaRef}
          className={styles.input}
          error={
            editing !== null
              ? editing.notice || limitMessage || undefined
              : notice || limitMessage || undefined
          }
          onChange={(event) => {
            if (editing !== null) {
              editing.onText(event.target.value)
              return
            }
            setDraft(chatId, event.target.value)
            setNotice('')
          }}
          onKeyDown={onKeyDown}
        />
        <IconButton
          label={editing === null ? 'Отправить сообщение' : 'Сохранить правку'}
          type="submit"
          className={styles.send}
          disabled={busy || issue !== null}
        >
          <SendIcon />
        </IconButton>
      </div>
    </form>
  )
}

function sameBanner(
  current: ComposerBanner | null,
  next: ComposerBanner,
): boolean {
  if (current === null || current.kind !== next.kind) {
    return false
  }

  if (current.kind === 'edit' && next.kind === 'edit') {
    return current.preview === next.preview
  }

  return (
    current.kind === 'reply' &&
    next.kind === 'reply' &&
    current.selection === next.selection
  )
}

function PencilIcon() {
  return (
    <svg className={styles.replyIcon} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M13.2 3.4a1.4 1.4 0 0 1 2 0l1.4 1.4a1.4 1.4 0 0 1 0 2L7.8 15.6 3.5 16.5l.9-4.3 8.8-8.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M11.8 4.8 15.2 8.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ReplyIcon() {
  return (
    <svg className={styles.replyIcon} viewBox="0 0 20 20" aria-hidden="true">
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

function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 12.75V3.25M3.25 8 8 3.25 12.75 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
