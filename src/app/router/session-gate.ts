import { chatsReturnPath } from './return-path.ts'

export function homePath(isAuthorized: boolean): '/chats' | '/connection' {
  return isAuthorized ? '/chats' : '/connection'
}

export function loginRedirect(input: { pathname: string; leaving: boolean }): {
  to: '/connection'
  remember: string | null
} {
  if (input.leaving) {
    return { to: '/connection', remember: null }
  }

  return {
    to: '/connection',
    remember: chatsReturnPath(input.pathname),
  }
}
