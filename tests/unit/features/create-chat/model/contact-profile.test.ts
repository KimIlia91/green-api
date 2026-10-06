import { describe, expect, it } from 'vitest'

import { contactProfile } from '@/features/create-chat/model/contact-profile.ts'

describe('contactProfile', () => {
  it('uses the address-book name, then the profile name', () => {
    expect(
      contactProfile({
        chatId: '10000000',
        contactName: ' Анна ',
        name: 'Профиль',
        phoneNumber: 79991234567,
      }),
    ).toEqual({
      name: 'Анна',
      username: null,
      phoneNumber: '79991234567',
    })

    expect(
      contactProfile({
        chatId: '10000000',
        contactName: '   ',
        name: ' Профиль ',
        phoneNumber: 0,
      }),
    ).toEqual({
      name: 'Профиль',
      username: null,
      phoneNumber: null,
    })
  })

  it('does not invent a username', () => {
    expect(
      contactProfile({
        chatId: '10000000',
        contactName: '',
        name: '',
        phoneNumber: 0,
      }).username,
    ).toBeNull()
  })
})
