export type DirectChatView = 'browse' | 'open' | 'loading' | 'error' | 'missing'

type ListStatus = 'idle' | 'loading' | 'ready' | 'error'

export function directChatView(input: {
  routeChatId: string | null
  listStatus: ListStatus
  chatExists: boolean
}): DirectChatView {
  if (input.routeChatId === null) {
    return 'browse'
  }

  if (input.chatExists) {
    return 'open'
  }

  if (input.listStatus === 'error') {
    return 'error'
  }

  if (input.listStatus === 'ready') {
    return 'missing'
  }

  return 'loading'
}
