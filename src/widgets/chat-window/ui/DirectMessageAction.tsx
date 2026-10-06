import { useEffect, useRef, useState } from 'react'

import { selectMessageById, useMessageStore } from '@/entities/message'
import { deleteConfirmLabel, deleteMessages } from '@/features/delete-messages'
import {
  forwardFollowUp,
  forwardSelectedMessages,
  ForwardTargetList,
} from '@/features/forward-messages'
import { Button, Dialog } from '@/shared/ui'

import styles from './SelectionDock.module.css'

export type DirectMessageActionState = {
  kind: 'forward' | 'delete'
  localId: string
}

export function DirectMessageAction({
  chatId,
  action,
  onClose,
  onNotice,
}: {
  chatId: string
  action: DirectMessageActionState
  onClose: () => void
  onNotice: (message: string) => void
}) {
  const message = useMessageStore(selectMessageById(action.localId))
  const [pending, setPending] = useState(false)
  const [confirm, setConfirm] = useState<{
    chatId: string
    message: string
  } | null>(null)
  const pendingRef = useRef(false)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    if (message === undefined || message.chatId !== chatId) {
      onClose()
    }
  }, [chatId, message, onClose])

  useEffect(() => {
    if (action.kind !== 'forward') {
      return
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || pendingRef.current) {
        return
      }
      event.preventDefault()
      onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [action.kind, onClose])

  async function runDelete() {
    if (pendingRef.current) {
      return
    }
    pendingRef.current = true
    setPending(true)
    onNotice('')
    const outcome = await deleteMessages([action.localId])
    pendingRef.current = false
    if (!aliveRef.current) {
      return
    }
    setPending(false)
    if (outcome.message !== '') {
      onNotice(outcome.message)
    }
    onClose()
  }

  async function runForward(targetChatId: string, acknowledgeUnknown = false) {
    if (pendingRef.current) {
      return
    }
    pendingRef.current = true
    setPending(true)
    onNotice('')
    const outcome = await forwardSelectedMessages(
      [action.localId],
      targetChatId,
      { acknowledgeUnknown },
    )
    pendingRef.current = false
    if (!aliveRef.current) {
      return
    }
    setPending(false)
    const follow = forwardFollowUp(outcome)
    if (follow.closeTarget) {
      setConfirm(null)
      if (follow.notice !== '') {
        onNotice(follow.notice)
      }
      onClose()
      return
    }
    if (follow.confirm !== null) {
      setConfirm({ chatId: targetChatId, message: follow.confirm })
    } else {
      setConfirm(null)
    }
    if (follow.notice !== '') {
      onNotice(follow.notice)
    }
  }

  if (message === undefined || message.chatId !== chatId) {
    return null
  }

  return (
    <>
      {action.kind === 'forward' ? (
        <ForwardTargetList
          pending={pending}
          confirm={confirm}
          onCancel={() => {
            if (!pendingRef.current) {
              onClose()
            }
          }}
          onPick={(targetChatId) => {
            void runForward(targetChatId)
          }}
          onConfirm={() => {
            if (confirm !== null) {
              void runForward(confirm.chatId, true)
            }
          }}
        />
      ) : null}
      <Dialog
        open={action.kind === 'delete'}
        title="Удалить сообщение"
        onClose={() => {
          if (!pendingRef.current) {
            onClose()
          }
        }}
      >
        <p className={styles.confirmText}>{deleteConfirmLabel(1)}</p>
        <div className={styles.confirmActions}>
          <Button
            type="button"
            onClick={() => {
              if (!pendingRef.current) {
                onClose()
              }
            }}
            disabled={pending}
          >
            Отмена
          </Button>
          <Button
            type="button"
            onClick={() => {
              void runDelete()
            }}
            disabled={pending}
          >
            Удалить
          </Button>
        </div>
      </Dialog>
    </>
  )
}
