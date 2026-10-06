import { useEffect, useMemo, useRef, useState } from 'react'

import {
  selectMessageIds,
  useMessageStore,
  type Message,
} from '@/entities/message'
import {
  deleteBlockReason,
  deleteConfirmLabel,
  deleteMessages,
} from '@/features/delete-messages'
import {
  forwardBlockReason,
  forwardFollowUp,
  forwardSelectedMessages,
  ForwardTargetList,
} from '@/features/forward-messages'
import {
  clearSelection,
  selectedInThreadOrder,
  SelectionBar,
  useSelectionStore,
} from '@/features/select-messages'
import { Button, Dialog } from '@/shared/ui'

import styles from './SelectionDock.module.css'

export function SelectionDock({ chatId }: { chatId: string }) {
  const localIds = useSelectionStore((state) => state.localIds)
  const threadIds = useMessageStore(selectMessageIds(chatId))
  const messagesById = useMessageStore((state) => state.messagesById)
  const messages = useMemo(
    () => orderedMessages(threadIds, localIds, messagesById),
    [threadIds, localIds, messagesById],
  )
  const [picking, setPicking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
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
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || pendingRef.current || confirming) {
        return
      }
      if (picking) {
        event.preventDefault()
        setPicking(false)
        return
      }
      event.preventDefault()
      clearSelection()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [confirming, picking])

  const deleteReason = deleteBlockReason(messages)
  const forwardReason = forwardBlockReason(messages)
  const reason = [notice, deleteReason, forwardReason]
    .filter((item) => item !== null && item !== '')
    .join(' ')

  function orderedNow(): string[] {
    const state = useMessageStore.getState()
    const selected = useSelectionStore.getState().localIds
    return selectedInThreadOrder(
      state.messageIdsByChatId[chatId] ?? [],
      selected,
    )
  }

  async function runDelete() {
    if (pendingRef.current) {
      return
    }
    pendingRef.current = true
    setPending(true)
    setNotice('')
    const outcome = await deleteMessages(orderedNow())
    pendingRef.current = false
    if (!aliveRef.current) {
      return
    }
    setPending(false)
    setConfirming(false)
    setNotice(outcome.message)
  }

  async function runForward(targetChatId: string, acknowledgeUnknown = false) {
    if (pendingRef.current) {
      return
    }
    pendingRef.current = true
    setPending(true)
    setNotice('')
    const outcome = await forwardSelectedMessages(orderedNow(), targetChatId, {
      acknowledgeUnknown,
    })
    pendingRef.current = false
    if (!aliveRef.current) {
      return
    }
    setPending(false)
    const follow = forwardFollowUp(outcome)
    if (follow.clearSelection) {
      clearSelection()
    }
    if (follow.closeTarget) {
      setPicking(false)
      setConfirm(null)
    } else if (follow.confirm !== null) {
      setConfirm({ chatId: targetChatId, message: follow.confirm })
    } else {
      setConfirm(null)
    }
    setNotice(follow.notice)
  }

  return (
    <>
      {picking ? (
        <ForwardTargetList
          pending={pending}
          confirm={confirm}
          onCancel={() => {
            if (!pendingRef.current) {
              setPicking(false)
              setConfirm(null)
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
      ) : (
        <SelectionBar
          count={messages.length}
          reason={reason}
          pending={pending}
          deleteDisabled={deleteReason !== null}
          forwardDisabled={forwardReason !== null}
          onCancel={clearSelection}
          onDelete={() => {
            if (pendingRef.current || deleteReason !== null) {
              return
            }
            setConfirming(true)
          }}
          onForward={() => {
            if (pendingRef.current || forwardReason !== null) {
              return
            }
            setNotice('')
            setConfirm(null)
            setPicking(true)
          }}
        />
      )}
      <Dialog
        open={confirming}
        title="Удалить сообщения"
        onClose={() => {
          if (!pendingRef.current) {
            setConfirming(false)
          }
        }}
      >
        <p className={styles.confirmText}>
          {deleteConfirmLabel(messages.length)}
        </p>
        <div className={styles.confirmActions}>
          <Button
            type="button"
            onClick={() => {
              setConfirming(false)
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

function orderedMessages(
  threadIds: readonly string[],
  selectedIds: readonly string[],
  messagesById: Record<string, Message>,
): Message[] {
  return selectedInThreadOrder(threadIds, selectedIds).flatMap((localId) => {
    const message = messagesById[localId]
    return message === undefined ? [] : [message]
  })
}
