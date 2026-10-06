import { useState, type ReactNode } from 'react'

import styles from './PortalHost.module.css'
import { PortalNodeContext } from './portal-node.ts'

export function PortalHost({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null)

  return (
    <PortalNodeContext value={node}>
      {children}
      <div ref={setNode} className={styles.host} />
    </PortalNodeContext>
  )
}
