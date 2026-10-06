import { describe, expect, it } from 'vitest'

import { unsupportedMessageText } from '@/entities/message'

import {
  createTextCopy,
  messageCopySource,
  writeClipboard,
} from '@/features/copy-message-text/model/copy-text.ts'

const source = 'Первая строка\nВторая 🎉\nhttps://green-api.com/v3/docs/'

describe('messageCopySource', () => {
  it('returns the message text with newlines and unicode', () => {
    expect(messageCopySource({ text: source, stickerUrl: null })).toBe(source)
  })

  it('skips empty text, stickers and unsupported placeholders', () => {
    expect(messageCopySource({ text: '', stickerUrl: null })).toBeNull()
    expect(
      messageCopySource({
        text: 'подпись',
        stickerUrl: 'https://example/s.png',
      }),
    ).toBeNull()
    expect(
      messageCopySource({ text: unsupportedMessageText, stickerUrl: null }),
    ).toBeNull()
  })
})

describe('createTextCopy', () => {
  it('writes the original text and reports success only after that', async () => {
    let written = ''
    const result = await createTextCopy().run(source, (value) => {
      written = value
      return Promise.resolve()
    })

    expect(written).toBe(source)
    expect(result).toBe('copied')
  })

  it('reports failure when the clipboard rejects the write', async () => {
    const result = await createTextCopy().run(source, () =>
      Promise.reject(new Error('denied')),
    )

    expect(result).toBe('failed')
  })

  it('does not start a second write while the first is still running', async () => {
    let writes = 0
    let finish = () => {}
    const copy = createTextCopy()
    const first = copy.run(
      source,
      () =>
        new Promise<void>((resolve) => {
          writes += 1
          finish = resolve
        }),
    )
    const second = await copy.run('другой', () => {
      writes += 1
      return Promise.resolve()
    })

    expect(second).toBe('busy')
    expect(writes).toBe(1)
    finish()
    await expect(first).resolves.toBe('copied')
  })
})

describe('writeClipboard', () => {
  it('fails when the clipboard API is missing', async () => {
    const previous = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    })

    await expect(writeClipboard(source)).rejects.toThrow(
      'clipboard unavailable',
    )

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: previous,
    })
  })
})
