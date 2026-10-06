import { describe, expect, it } from 'vitest'

import { composerPreviewLine } from '@/features/send-message/model/preview-line.ts'

describe('composerPreviewLine', () => {
  it('keeps a short line', () => {
    expect(composerPreviewLine('Коротко')).toBe('Коротко')
  })

  it('collapses line breaks and repeated spaces into one line', () => {
    expect(composerPreviewLine('первая\nвторая\n\nтретья')).toBe(
      'первая вторая третья',
    )
    expect(composerPreviewLine('а   б\tв')).toBe('а б в')
  })

  it('keeps a long word, a URL, and emoji intact for visual clipping', () => {
    const word = 'А'.repeat(80)
    const url = `https://example.com/${'path'.repeat(20)}`
    const emoji = '👨‍👩‍👧‍👦🔥 привет'

    expect(composerPreviewLine(word)).toBe(word)
    expect(composerPreviewLine(url)).toBe(url)
    expect(composerPreviewLine(`строка\n${emoji}`)).toBe(`строка ${emoji}`)
  })

  it('returns an empty line for blank text', () => {
    expect(composerPreviewLine('')).toBe('')
    expect(composerPreviewLine(' \n\t ')).toBe('')
  })
})
