import { useEffect, useLayoutEffect } from 'react'
import { Outlet, useLocation, useMatch, useNavigate } from 'react-router'

import { selectChatById, useChatStore } from '@/entities/chat'
import {
  loadChatList,
  selectChatListStatus,
  useLoadChatsStore,
} from '@/features/load-chats'
import {
  startReceiveLoop,
  stopReceiveLoop,
} from '@/features/receive-notifications'
import { MessengerPage } from '@/pages/messenger'
import { leaveMessenger } from '@/widgets/chat-sidebar'

import { directChatView } from './direct-chat.ts'
import { bindMessengerSendNotices } from './messenger-notices.ts'
import { chatPath, isChatLocation } from './paths.ts'
import { releaseClaimedReturn, startLeave } from './return-path.ts'
import { syncRouteChat } from './sync-route-chat.ts'

export function MessengerShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const match = useMatch('/chats/:chatId')
  const routeChatId = match?.params.chatId ?? null
  const listStatus = useLoadChatsStore(selectChatListStatus)
  const chat = useChatStore(selectChatById(routeChatId ?? ''))
  const chatExists = routeChatId !== null && chat !== undefined
  const directView = directChatView({
    routeChatId,
    listStatus,
    chatExists,
  })

  useEffect(() => {
    releaseClaimedReturn()
    const unbindSendNotices = bindMessengerSendNotices()
    startReceiveLoop()
    void loadChatList()
    return () => {
      unbindSendNotices()
      stopReceiveLoop()
    }
  }, [])

  useLayoutEffect(() => {
    syncRouteChat(routeChatId)
  }, [routeChatId, chatExists])

  return (
    <>
      <MessengerPage
        routeChatId={routeChatId}
        directView={directView}
        onChatChosen={(chatId) => {
          if (!isChatLocation(location.pathname, chatId)) {
            void navigate(chatPath(chatId))
          }
        }}
        onChatCreated={(chatId) => {
          if (!isChatLocation(location.pathname, chatId)) {
            void navigate(chatPath(chatId))
          }
        }}
        onBack={() => {
          if (location.pathname !== '/chats') {
            void navigate('/chats')
          }
        }}
        onLeave={() => {
          startLeave()
          leaveMessenger()
          void navigate('/connection', { replace: true })
        }}
      />
      <Outlet />
    </>
  )
}
