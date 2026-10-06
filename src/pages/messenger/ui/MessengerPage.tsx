import { useState } from 'react'

import { CreateChatDialog } from '@/features/create-chat'
import { ChatSidebar } from '@/widgets/chat-sidebar'
import { ChatWindow } from '@/widgets/chat-window'

import styles from './MessengerPage.module.css'

type DirectView = 'browse' | 'open' | 'loading' | 'error' | 'missing'

type MessengerPageProps = {
  routeChatId: string | null
  directView: DirectView
  onChatChosen: (chatId: string) => void
  onChatCreated: (chatId: string) => void
  onBack: () => void
  onLeave: () => void
}

export function MessengerPage({
  routeChatId,
  directView,
  onChatChosen,
  onChatCreated,
  onBack,
  onLeave,
}: MessengerPageProps) {
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <main
      className={styles.page}
      data-route={routeChatId === null ? 'list' : 'chat'}
    >
      <div className={styles.workspace} inert={createOpen ? true : undefined}>
        <div className={styles.sidebar}>
          <ChatSidebar
            selectedChatId={routeChatId}
            onCreateChat={() => {
              setCreateOpen(true)
            }}
            onChatChosen={onChatChosen}
            onLeave={onLeave}
          />
        </div>
        <section className={styles.conversation}>
          <ChatWindow
            routeChatId={routeChatId}
            directView={directView}
            onBack={onBack}
          />
        </section>
      </div>
      <CreateChatDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false)
        }}
        onCreated={onChatCreated}
      />
    </main>
  )
}
