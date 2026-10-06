import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  noteUnseenIncoming,
  recordChatActivity,
  resetChats,
  upsertChat,
  useChatStore,
} from '@/entities/chat'
import { addMessage, resetMessages, useMessageStore } from '@/entities/message'
import { clearSession, establishSession } from '@/entities/session'
import {
  cancelChatHistoryLoads,
  loadChatHistory,
} from '@/features/load-chat-history'
import {
  cancelChatPreviewLoads,
  loadChatPreviews,
} from '@/features/load-chat-previews'
import { createGreenApiClient, type ChatHistoryEntry } from '@/shared/api'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('chat list previews', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    cancelChatHistoryLoads()
    cancelChatPreviewLoads()
    resetMessages()
    resetChats()
    clearSession()
    establishSession(connection, 'authorized')
    upsertChat({
      chatId: '10000000',
      phoneNumber: '79991234567',
      name: 'Избранное',
      username: null,
    })
  })

  it('loads the full history after a one-message preview', async () => {
    const counts: number[] = []
    const client = {
      getChatHistory: (params: { chatId: string; count: number }) => {
        counts.push(params.count)
        return Promise.resolve([
          entry({
            text: params.count === 1 ? 'превью' : 'из истории',
            idMessage: params.count === 1 ? 'preview-id' : 'history-id',
          }),
        ])
      },
    }

    loadChatPreviews(['10000000'], {
      client,
      createId: () => 'preview-row',
    })
    await flush()

    expect(useChatStore.getState().chatsById['10000000']?.preview).toBe(
      'превью',
    )
    expect(counts).toEqual([1])

    await loadChatHistory('10000000', {
      client,
      createId: () => 'history-row',
    })

    expect(counts).toEqual([1, 100])
    expect(useMessageStore.getState().messageIdsByChatId['10000000']).toEqual([
      'preview-row',
      'history-row',
    ])
  })

  it('keeps a notification that arrives before the preview response', async () => {
    const pending = deferred<ChatHistoryEntry[]>()
    loadChatPreviews(['10000000'], {
      createId: () => 'preview-row',
      client: { getChatHistory: () => pending.promise },
    })
    await Promise.resolve()

    addMessage({
      localId: 'live-row',
      providerId: 'live-1',
      chatId: '10000000',
      text: 'живое',
      stickerUrl: null,
      stickerMimeType: null,
      direction: 'incoming',
      createdAt: 1_800_000_000_000,
      sentAt: null,
      sendState: null,
      errorText: null,
    })
    noteUnseenIncoming('10000000', 'live-1')
    recordChatActivity('10000000', {
      preview: 'живое',
      at: 1_800_000_000_000,
    })
    pending.resolve([
      entry({ text: 'старое', timestamp: 1_700_000_000, idMessage: 'old-1' }),
    ])
    await flush()

    expect(useChatStore.getState().chatsById['10000000']).toMatchObject({
      preview: 'живое',
      lastActivityAt: 1_800_000_000_000,
      unseenIncomingIds: ['live-1'],
    })
    expect(useChatStore.getState().activeChatId).toBeNull()
  })

  it('spaces a preview and full history without an extra scenario delay', async () => {
    vi.useFakeTimers()
    const starts: number[] = []
    const counts: number[] = []
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      starts.push(performance.now())
      counts.push(requestCount(init))
      return Promise.resolve(emptyJson())
    })
    const api = createGreenApiClient(connection, { fetchImpl })

    loadChatPreviews(['10000000'], { client: api })
    const history = loadChatHistory('10000000', { client: api })

    await vi.advanceTimersByTimeAsync(0)
    expect(counts).toEqual([1])
    await vi.advanceTimersByTimeAsync(1199)
    expect(counts).toEqual([1])
    await vi.advanceTimersByTimeAsync(1)
    await history

    expect(counts).toEqual([1, 100])
    const gap = (starts[1] ?? 0) - (starts[0] ?? 0)
    expect(gap).toBeGreaterThanOrEqual(1200)
    expect(gap).toBeLessThan(2400)
  })
})

function entry(
  patch: Partial<ChatHistoryEntry> & { text?: string },
): ChatHistoryEntry {
  const { text: textValue, ...rest } = patch
  return {
    type: 'incoming',
    idMessage: 'provider-1',
    timestamp: 1_700_000_000,
    chatId: '10000000',
    typeMessage: 'textMessage',
    text: textValue ?? 'текст',
    statusMessage: null,
    stickerUrl: null,
    stickerMimeType: null,
    isEdited: false,
    editedMessageId: null,
    editEvent: null,
    reaction: null,
    deletion: null,
    deleted: false,
    deletedMessageId: null,
    forwarded: false,
    forwardingScore: null,
    ...rest,
    quote: rest.quote ?? null,
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolvePromise: (value: T) => void = () => {
    throw new Error('deferred resolve is not ready')
  }
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value: T) => {
      resolvePromise(value)
    },
  }
}

function requestCount(init: RequestInit | undefined): number {
  if (typeof init?.body !== 'string') {
    throw new Error('expected a string request body')
  }

  const body: unknown = JSON.parse(init.body)
  if (typeof body !== 'object' || body === null || !('count' in body)) {
    throw new Error('expected a history count')
  }

  return typeof body.count === 'number' ? body.count : 0
}

function emptyJson(): Response {
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve()
  }
}
