export const messageLimit = 4000

export type MessageTextIssue = 'empty' | 'too-long'

export function messageTextIssue(text: string): MessageTextIssue | null {
  if (text.trim() === '') {
    return 'empty'
  }

  if (text.length > messageLimit) {
    return 'too-long'
  }

  return null
}

export function messageTextMessage(issue: MessageTextIssue): string {
  if (issue === 'empty') {
    return 'Введите текст сообщения.'
  }

  return 'Сообщение длиннее 4000 символов.'
}
