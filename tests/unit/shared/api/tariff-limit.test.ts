import { describe, expect, it } from 'vitest'

import { classifyTariffLimit } from '@/shared/api/tariff-limit.ts'

describe('classifyTariffLimit', () => {
  it('reads an exceeded chat quota from correspondentsStatus', () => {
    expect(
      classifyTariffLimit({
        invokeStatus: { status: 'QUOTE_ALLOWED' },
        correspondentsStatus: { status: 'CORRESPONDENTS_QUOTA_EXCEEDED' },
      }),
    ).toBe('chats')
  })

  it('reads an exceeded chat quota from quotaData', () => {
    expect(
      classifyTariffLimit({
        quotaData: { status: 'CORRESPONDENTS_QUOTE_EXCEEDED' },
      }),
    ).toBe('chats')
    expect(
      classifyTariffLimit({
        quotaData: { method: 'correspondents', status: 'QUOTE_EXCEEDED' },
      }),
    ).toBe('chats')
  })

  it('reads a method quota only from an exceeded invoke status', () => {
    expect(
      classifyTariffLimit({
        invokeStatus: { method: 'sendMessage', status: 'QUOTE_EXCEEDED' },
      }),
    ).toBe('method')
    expect(
      classifyTariffLimit({
        invokeStatus: { status: 'QUOTA_EXCEEDED' },
      }),
    ).toBe('method')
  })

  it('does not treat QUOTE_ALLOWED as a method quota', () => {
    expect(
      classifyTariffLimit({
        invokeStatus: {
          status: 'QUOTE_ALLOWED',
          description: 'Monthly quota has been exceeded',
        },
      }),
    ).toBe('unrecognized')
  })

  it('keeps an unrecognized body generic', () => {
    expect(classifyTariffLimit(null)).toBe('unrecognized')
    expect(classifyTariffLimit('quota')).toBe('unrecognized')
    expect(classifyTariffLimit({})).toBe('unrecognized')
    expect(
      classifyTariffLimit({
        invokeStatus: { status: 'PENDING' },
        correspondentsStatus: { status: 'QUOTE_ALLOWED' },
        quotaData: { status: 'QUOTE_ALLOWED' },
      }),
    ).toBe('unrecognized')
  })

  it('reports both quotas when each status is exceeded', () => {
    expect(
      classifyTariffLimit({
        invokeStatus: { status: 'QUOTA_EXCEEDED' },
        correspondentsStatus: { status: 'CORRESPONDENTS_QUOTA_EXCEEDED' },
      }),
    ).toBe('both')
  })
})
