import { ConnectionAccess } from '@/features/connect-instance'
import { leaveMessenger } from '@/widgets/chat-sidebar'

import styles from './ConnectionPage.module.css'

export function ConnectionPage() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>GREEN API MAX</h1>
        <p className={styles.text}>
          Введите реквизиты инстанса из личного кабинета GREEN-API
        </p>
        <ConnectionAccess onReset={leaveMessenger} />
      </div>
    </main>
  )
}
