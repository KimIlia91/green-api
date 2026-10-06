import { ToastHost } from '@/shared/lib/toast'
import { PortalHost } from '@/shared/ui'

import '@/shared/config'

import styles from './App.module.css'
import { AppRouter } from './router/index.ts'
import { useVisualViewport } from './useVisualViewport.ts'

export function App() {
  useVisualViewport()

  return (
    <div className={styles.root}>
      <PortalHost>
        <AppRouter />
      </PortalHost>
      <ToastHost />
    </div>
  )
}
