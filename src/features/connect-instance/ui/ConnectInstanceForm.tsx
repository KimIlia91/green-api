import { useEffect, useRef, useState, type FormEvent } from 'react'

import { Button, IconButton, Input } from '@/shared/ui'

import {
  connectToInstance,
  validateConnectDraft,
  type ConnectFieldErrors,
} from '../model/connect-to-instance.ts'
import { createSubmitGate } from '../model/submit-gate.ts'
import styles from './ConnectInstanceForm.module.css'

export function ConnectInstanceForm() {
  const [apiUrl, setApiUrl] = useState('')
  const [idInstance, setIdInstance] = useState('')
  const [apiTokenInstance, setApiTokenInstance] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<ConnectFieldErrors>({})
  const [statusMessage, setStatusMessage] = useState('')
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

    const draft = { apiUrl, idInstance, apiTokenInstance }
    const validated = validateConnectDraft(draft)
    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors)
      setStatusMessage('')
      gateRef.current.leave()
      return
    }

    const attempt = ++attemptRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setFieldErrors({})
    setStatusMessage('')
    setLoading(true)

    try {
      const outcome = await connectToInstance({
        draft,
        signal: controller.signal,
        isStale: () => attempt !== attemptRef.current,
      })

      if (attempt !== attemptRef.current || controller.signal.aborted) {
        return
      }

      if (outcome.status === 'invalid') {
        setFieldErrors(outcome.fieldErrors)
        return
      }

      if (outcome.status === 'rejected') {
        if (outcome.field) {
          setFieldErrors({ [outcome.field]: outcome.message })
          return
        }

        setStatusMessage(outcome.message)
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
      <div className={styles.fields}>
        <Input
          label="Адрес API"
          name="apiUrl"
          value={apiUrl}
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
          disabled={loading}
          error={fieldErrors.apiUrl}
          onChange={(event) => {
            setApiUrl(event.target.value)
          }}
        />
        <Input
          label="ID инстанса"
          name="idInstance"
          value={idInstance}
          autoComplete="off"
          spellCheck={false}
          inputMode="numeric"
          disabled={loading}
          error={fieldErrors.idInstance}
          onChange={(event) => {
            setIdInstance(event.target.value)
          }}
        />
        <div className={styles.tokenField}>
          <div className={styles.tokenInput}>
            <Input
              label="Токен API"
              name="apiTokenInstance"
              type={tokenVisible ? 'text' : 'password'}
              value={apiTokenInstance}
              autoComplete="off"
              spellCheck={false}
              disabled={loading}
              error={fieldErrors.apiTokenInstance}
              onChange={(event) => {
                setApiTokenInstance(event.target.value)
              }}
            />
          </div>
          <IconButton
            className={styles.tokenToggle}
            label={
              tokenVisible
                ? 'Скрыть apiTokenInstance'
                : 'Показать apiTokenInstance'
            }
            disabled={loading}
            onClick={() => {
              setTokenVisible((current) => !current)
            }}
          >
            <TokenVisibilityIcon hidden={!tokenVisible} />
          </IconButton>
        </div>
      </div>
      {statusMessage ? (
        <p className={styles.formError} role="alert">
          {statusMessage}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button className={styles.submit} type="submit" loading={loading}>
          Подключиться
        </Button>
      </div>
    </form>
  )
}

function TokenVisibilityIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M1.8 10S4.8 4.8 10 4.8 18.2 10 18.2 10 15.2 15.2 10 15.2 1.8 10 1.8 10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle
        cx="10"
        cy="10"
        r="2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      {hidden ? (
        <path
          d="M4 16 16 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  )
}
