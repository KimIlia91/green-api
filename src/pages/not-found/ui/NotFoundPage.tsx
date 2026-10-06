import { useNavigate } from 'react-router'

import { selectIsAuthorized, useSessionStore } from '@/entities/session'
import { Button } from '@/shared/ui'

import styles from './NotFoundPage.module.css'

export function NotFoundPage() {
  const navigate = useNavigate()
  const isAuthorized = useSessionStore(selectIsAuthorized)
  const target = isAuthorized ? '/chats' : '/connection'
  const label = isAuthorized ? 'К чатам' : 'К подключению'

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Страница не найдена</h1>
        <p className={styles.text}>Такого адреса в мессенджере нет.</p>
        <Button
          type="button"
          onClick={() => {
            void navigate(target)
          }}
        >
          {label}
        </Button>
      </div>
    </main>
  )
}
