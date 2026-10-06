import { beforeEach, describe, expect, it } from 'vitest'

import {
  beginSelection,
  clearSelection,
  retainSelection,
  selectedInThreadOrder,
  toggleSelection,
  useSelectionStore,
} from '@/features/select-messages/model/selection.ts'

describe('message selection', () => {
  beforeEach(() => {
    clearSelection()
  })

  it('starts on one message and keeps the mode when the last mark is cleared', () => {
    beginSelection('10000000', 'local-1')
    toggleSelection('10000000', 'local-1')

    expect(useSelectionStore.getState()).toMatchObject({
      chatId: '10000000',
      localIds: [],
    })
  })

  it('stores ids rather than click order for the thread', () => {
    beginSelection('10000000', 'local-2')
    toggleSelection('10000000', 'local-1')

    expect(
      selectedInThreadOrder(
        ['local-1', 'local-2', 'local-3'],
        useSelectionStore.getState().localIds,
      ),
    ).toEqual(['local-1', 'local-2'])
  })

  it('drops a message that disappeared and keeps the rest', () => {
    beginSelection('10000000', 'local-1')
    toggleSelection('10000000', 'local-2')
    retainSelection(['local-2', 'local-3'])

    expect(useSelectionStore.getState().localIds).toEqual(['local-2'])
  })

  it('does not reset when retain sees the same ids', () => {
    beginSelection('10000000', 'local-1')
    const before = useSelectionStore.getState().localIds
    retainSelection(['local-1'])
    expect(useSelectionStore.getState().localIds).toBe(before)
  })
})
