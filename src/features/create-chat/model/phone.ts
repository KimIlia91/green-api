export type PhoneIssue = 'empty' | 'invalid-characters' | 'invalid-format'

export type NormalizedPhone =
  { ok: true; digits: string } | { ok: false; issue: PhoneIssue }

const minPhoneDigits = 7
const maxPhoneDigits = 15

export function normalizePhone(raw: string): NormalizedPhone {
  let value = raw.trim()
  if (value === '') {
    return { ok: false, issue: 'empty' }
  }

  if (value.startsWith('+')) {
    value = value.slice(1).trim()
  }

  value = value.replace(/[\s()]/g, '').replace(/[-–—]/g, '')
  if (value === '') {
    return { ok: false, issue: 'empty' }
  }

  if (!/^\d+$/.test(value)) {
    return { ok: false, issue: 'invalid-characters' }
  }

  if (
    value.startsWith('0') ||
    value.length < minPhoneDigits ||
    value.length > maxPhoneDigits
  ) {
    return { ok: false, issue: 'invalid-format' }
  }

  return { ok: true, digits: value }
}

export function phoneIssueMessage(issue: PhoneIssue): string {
  if (issue === 'empty') {
    return 'Укажите номер телефона'
  }

  if (issue === 'invalid-characters') {
    return 'В номере есть недопустимые символы. Можно убрать пробелы, скобки, дефисы и плюс в начале.'
  }

  return 'Введите номер в международном формате: от 7 до 15 цифр, без ведущего нуля.'
}
