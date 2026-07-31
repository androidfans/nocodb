import { normalizeLocalLinkedRecords } from '~/utils/linkRecordUtils'

describe('normalizeLocalLinkedRecords', () => {
  it('wraps a single-target relation value in an array', () => {
    const record = { Id: 1, title: 'Linked record' }

    expect(normalizeLocalLinkedRecords(record)).toEqual([record])
  })

  it('preserves a multi-target relation array', () => {
    const records = [
      { Id: 1, title: 'First' },
      { Id: 2, title: 'Second' },
    ]

    expect(normalizeLocalLinkedRecords(records)).toBe(records)
  })

  it.each([null, undefined, '', 0, false])('normalizes an empty or invalid value (%s) to an empty array', (value) => {
    expect(normalizeLocalLinkedRecords(value)).toEqual([])
  })
})
