import { describe, expect, it } from 'vitest'
import { monthlyCents, parseMoney, splitByWeights, splitEqual } from '@fold/shared'

describe('parseMoney', () => {
  it('parses plain and formatted amounts to cents', () => {
    expect(parseMoney('12.34')).toBe(1234)
    expect(parseMoney('$1,234.56')).toBe(123456)
    expect(parseMoney('40')).toBe(4000)
    expect(parseMoney('0.1')).toBe(10)
  })

  it('rejects garbage', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('1.234')).toBeNull()
    expect(parseMoney('.')).toBeNull()
  })
})

describe('monthlyCents', () => {
  it('normalizes cadences to monthly averages', () => {
    expect(monthlyCents(100000, 'monthly')).toBe(100000)
    expect(monthlyCents(50000, 'semimonthly')).toBe(100000)
    expect(monthlyCents(100000, 'biweekly')).toBe(Math.round((100000 * 26) / 12))
    expect(monthlyCents(120000, 'annual')).toBe(10000)
    expect(monthlyCents(30000, 'weekly')).toBe(130000)
  })
})

describe('splits', () => {
  it('splits equally and gives remainder cents to the earliest users', () => {
    const splits = splitEqual(1001, ['a', 'b'])
    expect(splits.map((s) => s.share_cents)).toEqual([501, 500])
    expect(splits.reduce((sum, s) => sum + s.share_cents, 0)).toBe(1001)
  })

  it('splits by weights and always sums exactly', () => {
    const splits = splitByWeights(10000, [
      { user_id: 'a', weight: 585000 },
      { user_id: 'b', weight: 459167 },
    ])
    expect(splits.reduce((sum, s) => sum + s.share_cents, 0)).toBe(10000)
    expect(splits[0].share_cents).toBeGreaterThan(splits[1].share_cents)
  })

  it('falls back to equal when all weights are zero', () => {
    const splits = splitByWeights(999, [
      { user_id: 'a', weight: 0 },
      { user_id: 'b', weight: 0 },
      { user_id: 'c', weight: 0 },
    ])
    expect(splits.map((s) => s.share_cents)).toEqual([333, 333, 333])
    // remainder handling
    const uneven = splitByWeights(1000, [
      { user_id: 'a', weight: 0 },
      { user_id: 'b', weight: 0 },
      { user_id: 'c', weight: 0 },
    ])
    expect(uneven.reduce((sum, s) => sum + s.share_cents, 0)).toBe(1000)
  })
})
