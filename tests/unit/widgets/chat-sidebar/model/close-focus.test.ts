import { describe, expect, it } from 'vitest'

import { closeFocusTarget } from '@/widgets/chat-sidebar/model/close-focus.ts'

describe('closeFocusTarget', () => {
  it('returns the closed chat row when that row is on screen', () => {
    expect(closeFocusTarget(true)).toBe('row')
  })

  it('returns the list title when the row is hidden or missing', () => {
    expect(closeFocusTarget(false)).toBe('title')
  })
})
