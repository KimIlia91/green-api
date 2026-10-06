import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { unknownRetryWarning } from '@/entities/message/model/message-copy.ts'
import type { Message } from '@/entities/message/model/message.types.ts'
import { MessageBubble } from '@/entities/message/ui/MessageBubble.tsx'

const shown = vi.hoisted(() => ({
  message: null as Message | null,
}))

vi.mock('@/entities/message/model/message.store.ts', () => ({
  useMessageStore: (
    selector: (state: { messagesById: Record<string, Message> }) => unknown,
  ) =>
    selector({
      messagesById:
        shown.message === null
          ? {}
          : { [shown.message.localId]: shown.message },
    }),
}))

describe('MessageBubble send error', () => {
  it('keeps the failed retry control without the detailed error', () => {
    shown.message = outgoing('failed')

    const markup = renderToStaticMarkup(
      createElement(MessageBubble, { localId: 'local-1', onRetry: () => {} }),
    )

    expect(markup).toContain('Повторить')
    expect(markup).toContain('Не отправлено')
    expect(markup).not.toContain('Подробности')
    expect(markup).not.toContain('https://console.green-api.com')
    expect(markup).not.toContain('abc123')
  })

  it('keeps the unknown retry control and hides the duplicate warning until confirmation', () => {
    shown.message = outgoing('unknown')

    const markup = renderToStaticMarkup(
      createElement(MessageBubble, { localId: 'local-1', onRetry: () => {} }),
    )

    expect(markup).toContain('Повторить')
    expect(markup).toContain('Результат отправки неизвестен')
    expect(markup).not.toContain(unknownRetryWarning)
    expect(markup).not.toContain('могло уйти в очередь')
  })
})

function outgoing(sendState: 'failed' | 'unknown'): Message {
  return {
    localId: 'local-1',
    providerId: null,
    chatId: '10000000',
    text: 'hello',
    stickerUrl: null,
    stickerMimeType: null,
    direction: 'outgoing',
    createdAt: 1_700_000_000_000,
    sentAt: 1_700_000_000_000,
    sendState,
    errorText:
      'Подробности https://console.green-api.com и токен abc123. Результат отправки неизвестен. Сообщение могло уйти в очередь.',
  }
}
