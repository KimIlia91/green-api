import { useEffect, useState } from 'react'

import { readStoredCredentials } from '@/entities/session'
import { Button, Spinner } from '@/shared/ui'

import {
  cancelConnectionRestore,
  watchConnectionRestore,
} from '../model/restore-connection.ts'
import { ConnectInstanceForm } from './ConnectInstanceForm.tsx'
import styles from './ConnectionAccess.module.css'

type ConnectionView = 'form' | 'restoring' | 'failed'

type ConnectionAccessProps = {
  onReset: () => void
}

export function ConnectionAccess({ onReset }: ConnectionAccessProps) {
  const [view, setView] = useState<ConnectionView>(() =>
    readStoredCredentials() === null ? 'form' : 'restoring',
  )
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)

  // Повтор увеличивает `attempt`, чтобы эффект запустил восстановление заново.
  useEffect(() => {
    if (view !== 'restoring') {
      return
    }

    return watchConnectionRestore((outcome) => {
      if (outcome.status === 'rejected') {
        setMessage(outcome.message)
        setView('failed')
        return
      }

      if (outcome.status === 'absent' || outcome.status === 'invalid') {
        setView('form')
      }
    })
  }, [attempt, view])

  function resetConnection() {
    cancelConnectionRestore()
    onReset()
    setMessage('')
    setView('form')
  }

  const showForm = view === 'form'

  return (
    <>
      <div
        className={showForm ? styles.live : styles.idle}
        inert={!showForm}
        aria-hidden={!showForm}
      >
        <ConnectInstanceForm />
      </div>
      <div
        className={showForm ? styles.idle : styles.live}
        inert={showForm}
        aria-hidden={showForm}
      >
        <div className={styles.status}>
          <div className={styles.lead}>
            {view === 'failed' ? (
              <p className={styles.failure} role="alert">
                {message}
              </p>
            ) : (
              <p className={styles.statusText} role="status">
                {view === 'restoring' ? <Spinner decorative /> : null}
                Восстановление подключения
              </p>
            )}
          </div>
          <div className={styles.actions}>
            {view === 'failed' ? (
              <Button
                className={styles.action}
                type="button"
                onClick={() => {
                  setMessage('')
                  setAttempt((current) => current + 1)
                  setView('restoring')
                }}
              >
                Повторить
              </Button>
            ) : null}
            <Button
              className={styles.action}
              type="button"
              onClick={resetConnection}
            >
              Сбросить подключение
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
