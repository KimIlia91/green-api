import { hasSelectableText } from '@/entities/message'

export const copySuccessText = 'Текст скопирован'

export const copyFailureText =
  'Не удалось скопировать текст. Выделите его и скопируйте вручную.'

export function messageCopySource(message: {
  text: string
  stickerUrl: string | null
}): string | null {
  if (!hasSelectableText(message)) {
    return null
  }
  return message.text
}

export type CopyOutcome = 'copied' | 'failed' | 'busy'

export function createTextCopy() {
  let pending = false

  return {
    run(
      text: string,
      writeText: (value: string) => Promise<void>,
    ): Promise<CopyOutcome> {
      if (pending) {
        return Promise.resolve('busy')
      }

      pending = true
      return Promise.resolve()
        .then(() => writeText(text))
        .then(
          () => 'copied' as const,
          () => 'failed' as const,
        )
        .finally(() => {
          pending = false
        })
    },
  }
}

export async function writeClipboard(text: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
    throw new Error('clipboard unavailable')
  }

  await clipboard.writeText(text)
}
