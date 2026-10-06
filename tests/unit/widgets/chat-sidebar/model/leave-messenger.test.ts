import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { selectChat, upsertChat, useChatStore } from '@/entities/chat'
import { addMessage, useMessageStore } from '@/entities/message'
import {
  establishSession,
  readStoredCredentials,
  selectIsAuthorized,
  sessionCredentialStorageKey,
  useSessionStore,
} from '@/entities/session'
import {
  confirmedIncomingRead,
  scheduleIncomingRead,
  useIncomingReadStore,
} from '@/features/acknowledge-incoming'
import { restoreStoredConnection } from '@/features/connect-instance'
import { createChatFromPhone } from '@/features/create-chat'
import { deleteMessages } from '@/features/delete-messages'
import { beginEdit, saveEditedMessage } from '@/features/edit-message'
import { forwardSelectedMessages } from '@/features/forward-messages'
import { loadChatHistory } from '@/features/load-chat-history'
import { loadChatList } from '@/features/load-chats'
import {
  sendChatMessage,
  setDraft,
  useDraftStore,
} from '@/features/send-message'
import {
  GreenApiError,
  type CheckAccountResult,
  type GetStateInstanceResult,
  type SendMessageResult,
} from '@/shared/api'
import { resetToastStore, useToastStore } from '@/shared/lib/toast'

import { leaveMessenger } from '@/widgets/chat-sidebar/model/leave-messenger.ts'

describe('leaveMessenger', () => {
  beforeEach(() => {
    installMemorySessionStorage()
    resetToastStore()
    leaveMessenger()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears chats and the session together', () => {
    establishSession(
      {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      'authorized',
    )
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: null,
      username: null,
    })

    leaveMessenger()

    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
    expect(useSessionStore.getState().connection).toBeNull()
    expect(useChatStore.getState().chatIds).toEqual([])
    expect(useChatStore.getState().activeChatId).toBeNull()
    expect(readStoredCredentials()).toBeNull()
  })

  it('ignores a restore that finishes after leave', async () => {
    establishSession(
      {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      'authorized',
    )
    useSessionStore.setState({ connection: null, stateInstance: null })
    const pending = deferred<GetStateInstanceResult>()
    const outcome = restoreStoredConnection({
      getStateInstance: () => pending.promise,
    })

    leaveMessenger()
    pending.resolve({ stateInstance: 'authorized' })

    await expect(outcome).resolves.toEqual({ status: 'ignored' })
    expect(selectIsAuthorized(useSessionStore.getState())).toBe(false)
    expect(readStoredCredentials()).toBeNull()
    expect(useChatStore.getState().chatIds).toEqual([])
    expect(useMessageStore.getState().messagesById).toEqual({})
  })

  it('clears messages and drafts and ignores a late send', async () => {
    establishSession(
      {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      'authorized',
    )
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: null,
      username: null,
    })
    setDraft('10000000', 'черновик')
    expect(sessionStorage.getItem(sessionCredentialStorageKey)).not.toContain(
      'черновик',
    )
    const pending = deferred<SendMessageResult>()
    const request = sendChatMessage('10000000', 'hello', {
      createId: () => 'local-1',
      client: { sendMessage: () => pending.promise },
    })

    leaveMessenger()
    pending.resolve({ idMessage: 'provider-1' })
    await request

    expect(useMessageStore.getState().messagesById['local-1']).toBeUndefined()
    expect(useDraftStore.getState().draftsByChatId['10000000']).toBeUndefined()
    expect(useChatStore.getState().chatIds).toEqual([])
    expect(useSessionStore.getState().connection).toBeNull()
  })

  it('clears a send failure notice and ignores a late refusal', async () => {
    establishSession(
      {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      'authorized',
    )
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: null,
      username: null,
    })
    await sendChatMessage('10000000', 'hello', {
      createId: () => 'local-shown',
      client: {
        sendMessage: () =>
          Promise.reject(
            new GreenApiError('http', 'rejected', { status: 400 }),
          ),
      },
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    const pending = deferred<SendMessageResult>()
    const request = sendChatMessage('10000000', 'later', {
      createId: () => 'local-late',
      client: { sendMessage: () => pending.promise },
    })
    leaveMessenger()
    pending.reject(new GreenApiError('http', 'rejected', { status: 400 }))
    await request

    expect(useToastStore.getState().toasts).toEqual([])
    expect(useMessageStore.getState().messagesById['local-shown']).toBe(
      undefined,
    )
  })

  it('clears an edit failure notice and ignores a late edit refusal', async () => {
    establishSession(
      {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      'authorized',
    )
    const sentAt = 1_700_000_000_000
    addMessage({
      localId: 'local-edit',
      providerId: 'provider-edit',
      chatId: '10000000',
      text: 'Привет',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: sentAt,
      sentAt,
      sendState: 'sent',
      errorText: null,
    })
    const stored = useMessageStore.getState().messagesById['local-edit']
    if (stored === undefined) {
      throw new Error('edit fixture is missing')
    }
    beginEdit(stored, sentAt + 1_000)
    await saveEditedMessage('local-edit', 'Новый текст', {
      now: () => sentAt + 1_000,
      client: {
        editMessage: () =>
          Promise.reject(new GreenApiError('http', 'bad', { status: 400 })),
      },
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    const pending = deferred<{ idMessage: string }>()
    const request = saveEditedMessage('local-edit', 'Новый текст', {
      now: () => sentAt + 1_000,
      client: { editMessage: () => pending.promise },
    })
    leaveMessenger()
    pending.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await request

    expect(useToastStore.getState().toasts).toEqual([])
    expect(useMessageStore.getState().messagesById['local-edit']).toBe(
      undefined,
    )
  })

  it('clears a delete failure notice and ignores a late delete refusal', async () => {
    establishSession(
      {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      'authorized',
    )
    const sentAt = 1_700_000_000_000
    addMessage({
      localId: 'local-delete',
      providerId: 'provider-delete',
      chatId: '10000000',
      text: 'Привет',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'outgoing',
      createdAt: sentAt,
      sentAt,
      sendState: 'read',
      errorText: null,
    })
    await deleteMessages(['local-delete'], {
      client: {
        deleteMessage: () =>
          Promise.reject(new GreenApiError('http', 'bad', { status: 400 })),
      },
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    const pending = deferred<void>()
    const request = deleteMessages(['local-delete'], {
      client: { deleteMessage: () => pending.promise },
    })
    leaveMessenger()
    pending.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await request

    expect(useToastStore.getState().toasts).toEqual([])
    expect(useMessageStore.getState().messagesById['local-delete']).toBe(
      undefined,
    )
  })

  it('clears a forward failure notice and ignores a late forward refusal', async () => {
    establishSession(
      {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      'authorized',
    )
    const sentAt = 1_700_000_000_000
    addMessage({
      localId: 'local-forward',
      providerId: 'provider-forward',
      chatId: '10000000',
      text: 'Привет',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'incoming',
      createdAt: sentAt,
      sentAt,
      sendState: null,
      errorText: null,
    })
    await forwardSelectedMessages(['local-forward'], '20000000', {
      client: {
        forwardMessages: () =>
          Promise.reject(new GreenApiError('http', 'bad', { status: 400 })),
      },
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    const pending = deferred<{ messages: string[] }>()
    const request = forwardSelectedMessages(['local-forward'], '20000000', {
      client: { forwardMessages: () => pending.promise },
    })
    leaveMessenger()
    pending.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await request

    expect(useToastStore.getState().toasts).toEqual([])
    expect(useMessageStore.getState().messagesById['local-forward']).toBe(
      undefined,
    )
  })

  it('clears a chat-list failure notice and ignores a late list refusal', async () => {
    establishSession(
      {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      'authorized',
    )
    await loadChatList({
      client: {
        getChats: () => Promise.reject(new GreenApiError('network', 'offline')),
      },
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    const pending = deferred<
      {
        chatId: string
        name: string
        type: 'user'
        phoneNumber: number
      }[]
    >()
    const request = loadChatList({
      client: { getChats: () => pending.promise },
    })
    leaveMessenger()
    pending.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await request

    expect(useToastStore.getState().toasts).toEqual([])
    expect(useChatStore.getState().chatIds).toEqual([])
  })

  it('clears a history failure notice and ignores a late history refusal', async () => {
    establishSession(
      {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      'authorized',
    )
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: 'Анна',
      username: null,
    })
    selectChat('10000000')
    await loadChatHistory('10000000', {
      client: {
        getChatHistory: () =>
          Promise.reject(new GreenApiError('network', 'offline')),
      },
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    const pending = deferred<never[]>()
    const request = loadChatHistory('10000000', {
      refresh: true,
      client: { getChatHistory: () => pending.promise },
    })
    leaveMessenger()
    pending.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await request

    expect(useToastStore.getState().toasts).toEqual([])
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toBe(
      undefined,
    )
  })

  it('clears a check-account notice and ignores a late refusal', async () => {
    establishSession(
      {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      'authorized',
    )
    await createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => false,
      client: {
        checkAccount: () =>
          Promise.reject(new GreenApiError('network', 'offline')),
      },
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    const pending = deferred<CheckAccountResult>()
    const request = createChatFromPhone({
      rawPhone: '79991234567',
      signal: new AbortController().signal,
      isStale: () => useSessionStore.getState().connection === null,
      client: { checkAccount: () => pending.promise },
    })
    leaveMessenger()
    pending.reject(new GreenApiError('http', 'bad', { status: 400 }))
    await request

    expect(useToastStore.getState().toasts).toEqual([])
    expect(useChatStore.getState().chatIds).toEqual([])
  })

  it('ignores a read receipt that finishes after leave', async () => {
    establishSession(
      {
        apiUrl: 'https://3100.api.green-api.com',
        idInstance: '3100000001',
        apiTokenInstance: 'abc123',
      },
      'authorized',
    )
    addMessage({
      localId: 'local-1',
      providerId: 'incoming-1',
      chatId: '10000000',
      text: 'текст',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'incoming',
      createdAt: 1,
      sentAt: 1,
      sendState: null,
      errorText: null,
    })
    let release: (value: { setRead: boolean }) => void = () => {}
    const gate = new Promise<{ setRead: boolean }>((resolve) => {
      release = resolve
    })
    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'incoming-1' },
      { client: { readChat: () => gate } },
    )

    leaveMessenger()
    release({ setRead: true })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(
      confirmedIncomingRead({ chatId: '10000000', idMessage: 'incoming-1' }),
    ).toBe(false)
    expect(useIncomingReadStore.getState().notice).toBe('')
    expect(useMessageStore.getState().messagesById['local-1']).toBeUndefined()
  })
})

function installMemorySessionStorage(): void {
  const values = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  })
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => {
    throw new Error('deferred resolve is not ready')
  }
  let rejectPromise: (error: unknown) => void = () => {
    throw new Error('deferred reject is not ready')
  }
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  return {
    promise,
    resolve: (value: T) => {
      resolvePromise(value)
    },
    reject: (error: unknown) => {
      rejectPromise(error)
    },
  }
}
