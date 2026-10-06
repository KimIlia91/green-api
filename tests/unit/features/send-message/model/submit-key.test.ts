import { describe, expect, it } from 'vitest'

import { shouldSubmitOnEnter } from '@/features/send-message/model/submit-key.ts'

describe('shouldSubmitOnEnter', () => {
  it('sends on Enter and keeps Shift+Enter and IME composition', () => {
    expect(
      shouldSubmitOnEnter({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true)
    expect(
      shouldSubmitOnEnter({
        key: 'Enter',
        shiftKey: true,
        isComposing: false,
      }),
    ).toBe(false)
    expect(
      shouldSubmitOnEnter({
        key: 'Enter',
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false)
    expect(
      shouldSubmitOnEnter({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
        keyCode: 229,
      }),
    ).toBe(false)
    expect(
      shouldSubmitOnEnter({
        key: 'a',
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(false)
  })
})
