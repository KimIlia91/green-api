export const unsupportedMessageText = 'Этот тип сообщения не поддерживается'

export const stickerPreview = 'Стикер'

export function hasSelectableText(message: {
  text: string
  stickerUrl: string | null
}): boolean {
  return (
    message.stickerUrl === null &&
    message.text !== '' &&
    message.text !== unsupportedMessageText
  )
}

export function messagePreview(message: {
  text: string
  stickerUrl: string | null
}): string {
  if (message.stickerUrl !== null && message.text === '') {
    return stickerPreview
  }

  return message.text
}

export const unknownRetryWarning =
  'Сообщение могло быть отправлено. Повтор может создать дубль'
