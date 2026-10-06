import { describe, expect, it } from 'vitest'

import {
  nextOriginName,
  selfAuthorName,
} from '@/entities/message/model/forward-origin.ts'

describe('nextOriginName', () => {
  it('keeps an author already known for the message', () => {
    expect(
      nextOriginName({
        current: 'Анна',
        forwarded: true,
        knownAuthor: 'Борис',
      }),
    ).toBe('Анна')
  })

  it('does not take the current sender for a message that arrived already forwarded', () => {
    expect(
      nextOriginName({
        current: null,
        forwarded: true,
        knownAuthor: 'Борис',
      }),
    ).toBeNull()
  })

  it('stores the known author of a message that is not a forward', () => {
    expect(
      nextOriginName({
        current: null,
        forwarded: false,
        knownAuthor: selfAuthorName,
      }),
    ).toBe('Вы')
  })

  it('leaves the author empty when the contact name is unknown', () => {
    expect(
      nextOriginName({
        current: undefined,
        forwarded: false,
        knownAuthor: '  ',
      }),
    ).toBeNull()
  })
})
