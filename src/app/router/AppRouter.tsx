import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router'

import { selectIsAuthorized, useSessionStore } from '@/entities/session'
import { ConnectionPage } from '@/pages/connection'
import { NotFoundPage } from '@/pages/not-found'

import { MessengerShell } from './MessengerShell.tsx'
import {
  claimChatsReturn,
  finishLeave,
  isLeaving,
  rememberChatsReturn,
} from './return-path.ts'
import { homePath, loginRedirect } from './session-gate.ts'

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/connection" element={<ConnectionRoute />} />
        <Route element={<RequireSession />}>
          <Route element={<MessengerShell />}>
            <Route path="/chats" element={<ChatRouteSlot />} />
            <Route path="/chats/:chatId" element={<ChatRouteSlot />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

function HomeRoute() {
  const isAuthorized = useSessionStore(selectIsAuthorized)
  return <Navigate to={homePath(isAuthorized)} replace />
}

function ConnectionRoute() {
  const isAuthorized = useSessionStore(selectIsAuthorized)
  if (isAuthorized) {
    return <Navigate to={claimChatsReturn()} replace />
  }

  finishLeave()
  return <ConnectionPage />
}

function RequireSession() {
  const isAuthorized = useSessionStore(selectIsAuthorized)
  const location = useLocation()
  if (!isAuthorized) {
    const decision = loginRedirect({
      pathname: location.pathname,
      leaving: isLeaving(),
    })
    if (decision.remember !== null) {
      rememberChatsReturn(decision.remember)
    }
    return <Navigate to={decision.to} replace />
  }

  return <Outlet />
}

function ChatRouteSlot() {
  return null
}
