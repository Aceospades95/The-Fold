import { describe, expect, it } from 'vitest'
import { nextRepeatDate } from '../src/routes/lists.js'

describe('repeating list items', () => {
  it('steps forward by the cadence from the item’s own schedule', () => {
    expect(nextRepeatDate('2026-09-14', 'daily', '2026-09-14')).toBe('2026-09-15')
    expect(nextRepeatDate('2026-09-14', 'weekly', '2026-09-14')).toBe('2026-09-21')
    expect(nextRepeatDate('2026-09-14', 'biweekly', '2026-09-14')).toBe('2026-09-28')
    expect(nextRepeatDate('2026-09-14', 'monthly', '2026-09-14')).toBe('2026-10-14')
  })

  it('keeps the weekday when a chore is finished late, but never lands in the past', () => {
    // Three weeks overdue: the next Monday after today, not the Monday three weeks ago.
    expect(nextRepeatDate('2026-08-24', 'weekly', '2026-09-14')).toBe('2026-09-21')
    // Finished early (before the due date) still moves to the following occurrence.
    expect(nextRepeatDate('2026-09-21', 'weekly', '2026-09-19')).toBe('2026-09-28')
  })

  it('clamps month-end dates instead of skipping months', () => {
    expect(nextRepeatDate('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28')
    expect(nextRepeatDate('2026-08-31', 'monthly', '2026-08-31')).toBe('2026-09-30')
  })

  it('starts from today when the item never had a due date', () => {
    expect(nextRepeatDate(null, 'weekly', '2026-09-19')).toBe('2026-09-26')
  })
})
