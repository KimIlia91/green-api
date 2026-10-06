import { beforeEach, describe, expect, it } from 'vitest'

import {
  markIncomingViewed,
  noteUnseenIncoming,
  resetChats,
  upsertChat,
  useChatStore,
} from '@/entities/chat'
import { addMessage, useMessageStore } from '@/entities/message'
import { clearSession, establishSession } from '@/entities/session'
import { GreenApiError } from '@/shared/api'
import type { ReadChatParams } from '@/shared/api'
import { resetToastStore, useToastStore } from '@/shared/lib/toast'

import {
  armIncomingRead,
  cancelIncomingReads,
  confirmedIncomingRead,
  incomingReadNotice,
  readReceiptErrorMessage,
  scheduleIncomingRead,
  useIncomingReadStore,
} from '@/features/acknowledge-incoming/model/read-receipt.ts'

const connection = {
  apiUrl: 'https://3100.api.green-api.com',
  idInstance: '3100000001',
  apiTokenInstance: 'abc123',
}

describe('scheduleIncomingRead', () => {
  beforeEach(() => {
    cancelIncomingReads()
    resetToastStore()
    useMessageStore.getState().reset()
    resetChats()
    clearSession()
    establishSession(connection, 'authorized')
    upsertChat({
      chatId: '10000000',
      phoneNumber: null,
      name: 'Анна',
      username: null,
    })
  })

  it('calls ReadChat for a viewed incoming message', async () => {
    addIncoming('local-1', 'incoming-1')
    const calls: ReadChatParams[] = []

    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'incoming-1' },
      { client: client(calls) },
    )
    await settled()

    expect(calls).toEqual([{ chatId: '10000000', idMessage: 'incoming-1' }])
    expect(
      confirmedIncomingRead({ chatId: '10000000', idMessage: 'incoming-1' }),
    ).toBe(true)
  })

  it('still calls ReadChat after the local unread mark is gone', async () => {
    addIncoming('local-1', 'history-1')
    noteUnseenIncoming('10000000', 'history-1')
    markIncomingViewed('10000000', ['history-1'])
    const calls: ReadChatParams[] = []

    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'history-1' },
      { client: client(calls) },
    )
    await settled()

    expect(calls).toEqual([{ chatId: '10000000', idMessage: 'history-1' }])
  })

  it('sends the later thread message once, without comparing ids as numbers', async () => {
    addIncoming('local-100', '100')
    addIncoming('local-9', '9')
    const calls: ReadChatParams[] = []
    let release: (value: { setRead: boolean }) => void = () => {}
    const gate = new Promise<{ setRead: boolean }>((resolve) => {
      release = resolve
    })
    const readClient = {
      readChat: (params: ReadChatParams) => {
        calls.push(params)
        return calls.length === 1 ? gate : Promise.resolve({ setRead: true })
      },
    }

    scheduleIncomingRead(
      { chatId: '10000000', idMessage: '100' },
      { client: readClient },
    )
    scheduleIncomingRead(
      { chatId: '10000000', idMessage: '9' },
      { client: readClient },
    )
    expect(calls.map((params) => params.idMessage)).toEqual(['100'])

    release({ setRead: true })
    await settled()

    expect(calls.map((params) => params.idMessage)).toEqual(['100', '9'])
    expect(
      confirmedIncomingRead({ chatId: '10000000', idMessage: '100' }),
    ).toBe(true)
    expect(confirmedIncomingRead({ chatId: '10000000', idMessage: '9' })).toBe(
      true,
    )
  })

  it('does not record success when the response is false or an HTTP error', async () => {
    addIncoming('local-1', 'incoming-1')
    const calls: ReadChatParams[] = []
    const notices: string[] = []
    const unsubscribe = useIncomingReadStore.subscribe((state) => {
      notices.push(state.notice)
    })

    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'incoming-1' },
      {
        client: {
          readChat: (params) => {
            calls.push(params)
            return Promise.resolve({ setRead: false })
          },
        },
      },
    )
    await settled()
    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'incoming-1' },
      {
        client: {
          readChat: (params) => {
            calls.push(params)
            return Promise.resolve({ setRead: true })
          },
        },
      },
    )
    await settled()

    expect(calls).toHaveLength(1)
    expect(
      confirmedIncomingRead({ chatId: '10000000', idMessage: 'incoming-1' }),
    ).toBe(false)
    expect(useIncomingReadStore.getState().notice).toBe(readReceiptErrorMessage)
    expect(notices.filter((notice) => notice !== '')).toEqual([
      readReceiptErrorMessage,
    ])

    armIncomingRead('10000000')
    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'incoming-1' },
      { client: client(calls) },
    )
    await settled()

    expect(calls).toHaveLength(2)
    expect(
      confirmedIncomingRead({ chatId: '10000000', idMessage: 'incoming-1' }),
    ).toBe(true)
    expect(useIncomingReadStore.getState().notice).toBe('')
    unsubscribe()
  })

  it('does not retry HTTP 466 for a later message', async () => {
    addIncoming('local-1', 'incoming-1')
    addIncoming('local-2', 'incoming-2')
    const calls: ReadChatParams[] = []

    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'incoming-1' },
      {
        client: {
          readChat: (params) => {
            calls.push(params)
            return Promise.reject(
              new GreenApiError('http', 'quota', { status: 466 }),
            )
          },
        },
      },
    )
    await settled()
    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'incoming-2' },
      {
        client: {
          readChat: (params) => {
            calls.push(params)
            return Promise.resolve({ setRead: true })
          },
        },
      },
    )
    await settled()
    armIncomingRead('10000000')
    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'incoming-2' },
      {
        client: {
          readChat: (params) => {
            calls.push(params)
            return Promise.resolve({ setRead: true })
          },
        },
      },
    )
    await settled()

    expect(calls.map((params) => params.idMessage)).toEqual(['incoming-1'])
    expect(
      confirmedIncomingRead({ chatId: '10000000', idMessage: 'incoming-1' }),
    ).toBe(false)
    expect(
      confirmedIncomingRead({ chatId: '10000000', idMessage: 'incoming-2' }),
    ).toBe(false)
    expect(incomingReadNotice('10000000')).toBe('')
    expect(toastTexts()).toEqual(['Сработало ограничение тарифа.'])
  })

  it('toasts one classified ReadChat quota and leaves the local view mark', async () => {
    addIncoming('local-1', 'incoming-1')
    addIncoming('local-2', 'incoming-2')
    noteUnseenIncoming('10000000', 'incoming-1')
    markIncomingViewed('10000000', ['incoming-1'])
    const bodies = [
      {
        invokeStatus: { status: 'QUOTE_ALLOWED' },
        correspondentsStatus: { status: 'CORRESPONDENTS_QUOTA_EXCEEDED' },
      },
      {
        invokeStatus: { status: 'QUOTE_EXCEEDED' },
        quotaData: { status: 'QUOTE_ALLOWED' },
      },
      {
        invokeStatus: { status: 'QUOTA_EXCEEDED' },
        correspondentsStatus: { status: 'CORRESPONDENTS_QUOTA_EXCEEDED' },
      },
      { invokeStatus: { status: 'QUOTE_ALLOWED' } },
      null,
    ]
    const notices = [
      'Превышена квота чатов тарифа.',
      'Превышена месячная квота отметки прочтения.',
      'Превышена квота чатов и отметки прочтения.',
      'Сработало ограничение тарифа.',
      'Сработало ограничение тарифа.',
    ]

    for (const [index, body] of bodies.entries()) {
      cancelIncomingReads()
      resetToastStore()
      establishSession(connection, 'authorized')
      const calls: ReadChatParams[] = []
      scheduleIncomingRead(
        { chatId: '10000000', idMessage: 'incoming-1' },
        {
          client: {
            readChat: (params) => {
              calls.push(params)
              return Promise.reject(
                new GreenApiError('http', 'quota', {
                  status: 466,
                  responseBody: body,
                }),
              )
            },
          },
        },
      )
      await settled()
      scheduleIncomingRead(
        { chatId: '10000000', idMessage: 'incoming-2' },
        {
          client: {
            readChat: (params) => {
              calls.push(params)
              return Promise.resolve({ setRead: true })
            },
          },
        },
      )
      await settled()

      expect(calls).toHaveLength(1)
      expect(toastTexts()).toEqual([notices[index]])
      expect(notices[index]).not.toMatch(/QUOTE|https|incoming-1/)
      expect(incomingReadNotice('10000000')).toBe('')
      expect(
        confirmedIncomingRead({ chatId: '10000000', idMessage: 'incoming-1' }),
      ).toBe(false)
      expect(
        useChatStore.getState().chatsById['10000000']?.unseenIncomingIds,
      ).toEqual([])
    }
  })

  it('ignores a late success after the session is cancelled', async () => {
    addIncoming('local-1', 'incoming-1')
    let release: (value: { setRead: boolean }) => void = () => {}
    const gate = new Promise<{ setRead: boolean }>((resolve) => {
      release = resolve
    })
    const calls: ReadChatParams[] = []

    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'incoming-1' },
      {
        client: {
          readChat: (params) => {
            calls.push(params)
            return gate
          },
        },
      },
    )
    cancelIncomingReads()
    clearSession()
    establishSession(connection, 'authorized')
    release({ setRead: true })
    await settled()

    expect(
      confirmedIncomingRead({ chatId: '10000000', idMessage: 'incoming-1' }),
    ).toBe(false)
    expect(useIncomingReadStore.getState().notice).toBe('')

    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'incoming-1' },
      { client: client(calls) },
    )
    await settled()

    expect(calls).toHaveLength(2)
    expect(
      confirmedIncomingRead({ chatId: '10000000', idMessage: 'incoming-1' }),
    ).toBe(true)
  })

  it('keeps a read error on the chat that failed and clears it after that chat succeeds', async () => {
    upsertChat({
      chatId: '20000000',
      phoneNumber: null,
      name: 'Борис',
      username: null,
    })
    addIncoming('local-1', 'history-1')
    addIncoming('local-2', 'history-2', '20000000')
    const calls: ReadChatParams[] = []

    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'history-1' },
      {
        client: {
          readChat: (params) => {
            calls.push(params)
            return Promise.resolve({ setRead: false })
          },
        },
      },
    )
    await settled()

    expect(incomingReadNotice('10000000')).toBe(readReceiptErrorMessage)
    expect(incomingReadNotice('20000000')).toBe('')

    scheduleIncomingRead(
      { chatId: '20000000', idMessage: 'history-2' },
      {
        client: {
          readChat: (params) => {
            calls.push(params)
            return Promise.resolve({ setRead: true })
          },
        },
      },
    )
    await settled()

    expect(incomingReadNotice('10000000')).toBe(readReceiptErrorMessage)
    expect(incomingReadNotice('20000000')).toBe('')
    expect(calls.map((params) => params.chatId)).toEqual([
      '10000000',
      '20000000',
    ])

    armIncomingRead('10000000')
    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'history-1' },
      { client: client(calls) },
    )
    await settled()

    expect(incomingReadNotice('10000000')).toBe('')
  })

  it('selects the same history message again after a reload clears the confirmation', async () => {
    addIncoming('local-1', 'history-1')
    const calls: ReadChatParams[] = []

    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'history-1' },
      { client: client(calls) },
    )
    await settled()
    cancelIncomingReads()
    establishSession(connection, 'authorized')

    scheduleIncomingRead(
      { chatId: '10000000', idMessage: 'history-1' },
      { client: client(calls) },
    )
    await settled()

    expect(calls).toEqual([
      { chatId: '10000000', idMessage: 'history-1' },
      { chatId: '10000000', idMessage: 'history-1' },
    ])
  })
})

function client(calls: ReadChatParams[]): {
  readChat: (params: ReadChatParams) => Promise<{ setRead: boolean }>
} {
  return {
    readChat: (params) => {
      calls.push(params)
      return Promise.resolve({ setRead: true })
    },
  }
}

function addIncoming(
  localId: string,
  providerId: string,
  chatId = '10000000',
): void {
  addMessage({
    localId,
    providerId,
    chatId,
    text: 'текст',
    stickerUrl: null,
    stickerMimeType: null,
    direction: 'incoming',
    createdAt: 1,
    sentAt: 1,
    sendState: null,
    errorText: null,
  })
}

function toastTexts(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message)
}

function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}
