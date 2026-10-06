import { useEffect, useRef, useState, type FormEvent } from 'react'

import { sessionIdentity, useSessionStore } from '@/entities/session'
import { Button, Dialog, Input } from '@/shared/ui'

import { createChatFromPhone } from '../model/create-chat.ts'
import { createSubmitGate } from '../model/submit-gate.ts'
import styles from './CreateChatDialog.module.css'

type CreateChatDialogProps = {
  open: boolean
  onClose: () => void
  onCreated: (chatId: string) => void
}

export function CreateChatDialog({
  open,
  onClose,
  onCreated,
}: CreateChatDialogProps) {
  return (
    <Dialog open={open} title="Новый чат" onClose={onClose}>
      {open ? <CreateChatForm onClose={onClose} onCreated={onCreated} /> : null}
    </Dialog>
  )
}

function CreateChatForm({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (chatId: string) => void
}) {
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const gateRef = useRef(createSubmitGate())
  const attemptRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const gate = gateRef.current
    return () => {
      attemptRef.current += 1
      abortRef.current?.abort()
      gate.leave()
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!gateRef.current.tryEnter()) {
      return
    }

    const attempt = ++attemptRef.current
    const startedKey = connectionKey()
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setMessage('')
    setLoading(true)

    try {
      const outcome = await createChatFromPhone({
        rawPhone: phone,
        signal: controller.signal,
        isStale: () =>
          attempt !== attemptRef.current || startedKey !== connectionKey(),
      })

      if (attempt !== attemptRef.current || controller.signal.aborted) {
        return
      }

      if (outcome.status === 'created') {
        onCreated(outcome.chatId)
        onClose()
        return
      }

      if (outcome.status === 'invalid' || outcome.status === 'rejected') {
        setMessage(outcome.message)
      }
    } finally {
      if (attempt === attemptRef.current) {
        setLoading(false)
        gateRef.current.leave()
      }
    }
  }

  return (
    <form
      className={styles.form}
      autoComplete="off"
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
    >
      <Input
        label="Номер телефона"
        name="phone"
        value={phone}
        inputMode="tel"
        autoComplete="off"
        spellCheck={false}
        disabled={loading}
        placeholder="79991234567"
        hint="Введите номер с кодом страны, например 79991234567"
        error={message || undefined}
        onChange={(event) => {
          setPhone(event.target.value)
        }}
      />
      <div className={styles.actions}>
        <Button type="submit" loading={loading}>
          Создать
        </Button>
        <Button
          type="button"
          className={styles.cancel}
          disabled={loading}
          onClick={onClose}
        >
          Отмена
        </Button>
      </div>
    </form>
  )
}

function connectionKey(): string {
  return sessionIdentity(useSessionStore.getState().connection)
}
