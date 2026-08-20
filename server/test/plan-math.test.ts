import { describe, expect, it } from 'vitest'
import {
  PLAN_ALLOC_KEYS,
  type PlanState,
  checksInMonth,
  computePlan,
  defaultPlanState,
  fairness,
  federalTax,
  migratePlanState,
  planAnnualGross,
  planId,
  planMonthGross,
  planPerCheck,
  rebalanceAlloc,
} from '@fold/shared'

function base(): PlanState {
  const state = defaultPlanState()
  state.people[0] = { ...state.people[0], pay_type: 'salary', salary: 85000, k401_pct: 0, items: [] }
  state.people[1] = { ...state.people[1], pay_type: 'salary', salary: 70000, k401_pct: 0, items: [] }
  return state
}

describe('federal tax (2026)', () => {
  it('walks the MFJ brackets correctly', () => {
    // 10% of 24,800 + 12% of (100,000 − 24,800)
    expect(federalTax(100_000, 'mfj')).toBeCloseTo(2480 + 0.12 * 75_200, 2)
    expect(federalTax(0, 'mfj')).toBe(0)
  })

  it('single brackets differ from MFJ at the same taxable income', () => {
    expect(federalTax(200_000, 'single')).toBeGreaterThan(federalTax(200_000, 'mfj'))
  })
})

describe('pay types and frequency', () => {
  it('annualizes salary and hourly pay correctly', () => {
    const p = base().people[0]
    expect(planAnnualGross({ ...p, pay_type: 'salary', salary: 91_000 })).toBe(91_000)
    expect(planAnnualGross({ ...p, pay_type: 'hourly', hourly_rate: 25, hours_per_week: 40 })).toBe(52_000)
    expect(planAnnualGross({ ...p, pay_type: 'hourly', hourly_rate: 43.75, hours_per_week: 40 })).toBe(91_000)
    // 30 hours part-time.
    expect(planAnnualGross({ ...p, pay_type: 'hourly', hourly_rate: 20, hours_per_week: 30 })).toBe(31_200)
  })

  it('derives per-paycheck gross from the pay frequency, not the pay type', () => {
    const p = { ...base().people[0], pay_type: 'salary' as const, salary: 91_000 }
    expect(planPerCheck({ ...p, pay_freq: 'biweekly' })).toBeCloseTo(3500, 6)
    expect(planPerCheck({ ...p, pay_freq: 'semimonthly' })).toBeCloseTo(91_000 / 24, 6)
    expect(planPerCheck({ ...p, pay_freq: 'weekly' })).toBeCloseTo(1750, 6)
    expect(planPerCheck({ ...p, pay_freq: 'monthly' })).toBeCloseTo(91_000 / 12, 6)
    const hourly = { ...p, pay_type: 'hourly' as const, hourly_rate: 43.75, hours_per_week: 40 }
    expect(planPerCheck({ ...hourly, pay_freq: 'biweekly' })).toBeCloseTo(3500, 6)
  })

  it('counts paychecks per calendar month from the payday anchor', () => {
    const p = { ...base().people[0], pay_type: 'salary' as const, salary: 91_000, pay_freq: 'biweekly' as const }
    // Paydays every other Friday from Sep 4, 2026: Sep 4+18 → 2; Oct 2+16+30 → 3.
    const anchored = { ...p, next_payday: '2026-09-04' }
    expect(checksInMonth(anchored, '2026-09')).toBe(2)
    expect(checksInMonth(anchored, '2026-10')).toBe(3)
    expect(planMonthGross(anchored, '2026-09')).toBeCloseTo(7000, 6)
    expect(planMonthGross(anchored, '2026-10')).toBeCloseTo(10500, 6)
    // The anchor can sit anywhere in the series — a payday later in the month works too.
    expect(checksInMonth({ ...p, next_payday: '2026-10-16' }, '2026-10')).toBe(3)

    const weekly = { ...p, pay_freq: 'weekly' as const, next_payday: '2026-09-04' }
    expect(checksInMonth(weekly, '2026-09')).toBe(4)
    expect(checksInMonth(weekly, '2026-10')).toBe(5)

    expect(checksInMonth({ ...p, pay_freq: 'monthly' }, '2026-09')).toBe(1)
    expect(checksInMonth({ ...p, pay_freq: 'semimonthly' }, '2026-09')).toBe(2)

    // Whatever the anchor (even none), a year always totals 26 biweekly checks.
    const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`)
    const anchorless = { ...p, next_payday: null }
    expect(months.reduce((sum, m) => sum + checksInMonth(anchorless, m), 0)).toBe(26)
    expect(months.reduce((sum, m) => sum + checksInMonth(anchored, m), 0)).toBe(26)
  })

  it('an hourly rate and its salary equivalent produce the same plan', () => {
    const salaried = base()
    salaried.people[0].salary = 91_000
    const hourly = base()
    hourly.people[0].pay_type = 'hourly'
    hourly.people[0].hourly_rate = 43.75
    hourly.people[0].hours_per_week = 40
    expect(computePlan(hourly).pool).toBeCloseTo(computePlan(salaried).pool, 4)
    // Pay frequency is display-only — it never moves the pool.
    hourly.people[0].pay_freq = 'weekly'
    expect(computePlan(hourly).pool).toBeCloseTo(computePlan(salaried).pool, 4)
  })
})

describe('computePlan', () => {
  it('caps Social Security at the wage base', () => {
    const state = base()
    state.people[0].salary = 200_000
    state.people[1].salary = 0
    const math = computePlan(state)
    expect(math.people[0].fica).toBeCloseTo(0.062 * 184_500 + 0.0145 * 200_000, 2)
  })

  it('lets §125 lines skip FICA while plain pre-tax lines do not', () => {
    const withS125 = base()
    withS125.people[0].items = [{ id: planId(), name: 'Medical', amt: 200, per: 'mo', type: 's125' }]
    const withPretax = base()
    withPretax.people[0].items = [{ id: planId(), name: 'Other', amt: 200, per: 'mo', type: 'pretax' }]
    const a = computePlan(withS125)
    const b = computePlan(withPretax)
    expect(a.taxable).toBeCloseTo(b.taxable, 2)
    expect(a.people[0].fica).toBeLessThan(b.people[0].fica)
    expect(b.people[0].fica - a.people[0].fica).toBeCloseTo(2400 * (0.062 + 0.0145), 2)
  })

  it('holds the pool identity: gross − pre − post − tax, and contributions sum to it', () => {
    const state = base()
    state.people[0].k401_pct = 6
    state.people[0].items = [{ id: planId(), name: 'Medical', amt: 120, per: 'mo', type: 's125' }]
    state.people[1].items = [{ id: planId(), name: 'Roth', amt: 100, per: 'mo', type: 'posttax' }]
    const math = computePlan(state)
    expect(math.pool).toBeCloseTo(math.gross - math.pre - math.post - math.tax, 6)
    expect(math.people[0].contrib + math.people[1].contrib).toBeCloseTo(math.pool, 6)
    expect(math.people[0].share + math.people[1].share).toBeCloseTo(1, 6)
  })

  it('shows the marriage bonus for a one-earner couple', () => {
    const married = base()
    married.people[0].salary = 150_000
    married.people[1].salary = 0
    const single = { ...married, filing: 'single' as const }
    expect(computePlan(married).tax).toBeLessThan(computePlan(single).tax)
  })

  it('manual tax mode uses each person’s own rate and keeps the identities', () => {
    const state = base()
    state.tax_mode = 'manual'
    state.people[0].manual_tax_pct = 25
    state.people[1].manual_tax_pct = 18
    const math = computePlan(state)
    expect(math.tax).toBeCloseTo(0.25 * 85_000 + 0.18 * 70_000, 4)
    expect(math.fica).toBe(0)
    expect(math.people[0].share_tax).toBeCloseTo(21_250, 4)
    expect(math.pool).toBeCloseTo(math.gross - math.pre - math.post - math.tax, 6)
    expect(math.people[0].contrib + math.people[1].contrib).toBeCloseTo(math.pool, 6)
  })

  it('percent categories track the pool while fixed ones stay put', () => {
    const state = base()
    state.cats = [
      { id: planId(), name: 'Rent', mode: 'fixed', amt: 2000, benefit_a: 50 },
      { id: planId(), name: 'Groceries', mode: 'pct', amt: 8, benefit_a: 50 },
    ]
    const math = computePlan(state)
    expect(math.cat_monthly[0]).toBe(2000)
    expect(math.cat_monthly[1]).toBeCloseTo(math.pool_mo * 0.08, 6)
    // Doubling income doubles the pct line, not the fixed one.
    state.people[0].salary = 170_000
    const richer = computePlan(state)
    expect(richer.cat_monthly[0]).toBe(2000)
    expect(richer.cat_monthly[1]).toBeGreaterThan(math.cat_monthly[1] * 1.3)
  })

  it('splits personal allowances equally or by contribution share', () => {
    const state = base()
    state.alloc = { living: 60, savings: 10, invest: 10, trip: 6, personal: 14 }
    const equal = computePlan(state)
    expect(equal.personal_a).toBeCloseTo(equal.personal_b, 6)
    state.personal_mode = 'prop'
    const prop = computePlan(state)
    expect(prop.personal_a).toBeGreaterThan(prop.personal_b)
    expect(prop.personal_a + prop.personal_b).toBeCloseTo(prop.alloc.personal, 6)
  })
})

describe('rebalanceAlloc', () => {
  it('always totals 100 and honors the changed slider', () => {
    let alloc = defaultPlanState().alloc
    for (const [key, value] of [
      ['living', 80],
      ['trip', 0],
      ['personal', 33.5],
      ['savings', 100],
      ['savings', 12],
    ] as const) {
      alloc = rebalanceAlloc(alloc, key, value)
      const total = PLAN_ALLOC_KEYS.reduce((sum, k) => sum + alloc[k], 0)
      expect(total).toBeCloseTo(100, 6)
    }
    expect(alloc.savings).toBeCloseTo(12, 6)
  })

  it('recovers when one bucket had swallowed everything', () => {
    let alloc = { living: 100, savings: 0, invest: 0, trip: 0, personal: 0 }
    alloc = rebalanceAlloc(alloc, 'living', 60)
    expect(PLAN_ALLOC_KEYS.reduce((sum, k) => sum + alloc[k], 0)).toBeCloseTo(100, 6)
    expect(alloc.savings).toBeGreaterThan(0)
  })

  it('never moves a locked bucket and clamps against it', () => {
    let alloc = { living: 62, savings: 12, invest: 8, trip: 4, personal: 14 }
    alloc = rebalanceAlloc(alloc, 'living', 70, ['savings'])
    expect(alloc.savings).toBe(12)
    expect(alloc.living).toBeCloseTo(70, 6)
    expect(PLAN_ALLOC_KEYS.reduce((sum, k) => sum + alloc[k], 0)).toBeCloseTo(100, 6)

    // Locked 12% caps everything else at 88.
    alloc = rebalanceAlloc(alloc, 'living', 95, ['savings'])
    expect(alloc.living).toBeCloseTo(88, 6)
    expect(alloc.savings).toBe(12)
    expect(PLAN_ALLOC_KEYS.reduce((sum, k) => sum + alloc[k], 0)).toBeCloseTo(100, 6)

    // With every other bucket locked, the changed one just takes the remainder.
    const pinned = rebalanceAlloc(
      { living: 50, savings: 20, invest: 10, trip: 10, personal: 10 },
      'living',
      80,
      ['savings', 'invest', 'trip', 'personal'],
    )
    expect(pinned.living).toBeCloseTo(50, 6)
    expect(pinned.savings).toBe(20)
  })
})

describe('fairness', () => {
  it('puts and gets each account for the whole pool', () => {
    const state = base()
    state.cats = [
      { id: planId(), name: 'Rent', mode: 'fixed', amt: 2000, benefit_a: 50 },
      { id: planId(), name: 'Car', mode: 'fixed', amt: 400, benefit_a: 80 },
    ]
    const math = computePlan(state)
    const { puts, gets } = fairness(state, math)
    expect(puts[0] + puts[1]).toBeCloseTo(math.pool_mo, 4)
    expect(gets[0] + gets[1]).toBeCloseTo(math.pool_mo, 4)
    expect(gets[0]).toBeGreaterThan(gets[1])
  })
})

describe('migration', () => {
  it('adopts a v1 state (annual gross, plain cats) into v3 without losing numbers', () => {
    const v1 = {
      v: 1,
      filing: 'mfj',
      state_rate: 4.95,
      std_ded: 32200,
      people: [
        { user_id: 'u1', name: 'Jake', color: '#8b5cf6', gross: 91000, k401_pct: 6, items: [] },
        { user_id: null, name: 'Partner', color: '#10b981', gross: 48000, k401_pct: 0, items: [] },
      ],
      alloc: { living: 50, savings: 20, invest: 10, trip: 5, personal: 15 },
      cats: [{ id: 'c1', name: 'Rent', amt: 2100, benefit_a: 50, fold_category_id: 'abc' }],
      personal_mode: 'equal',
      trip_goal: 8000,
    }
    const migrated = migratePlanState(v1)!
    expect(migrated.v).toBe(3)
    expect(migrated.tax_mode).toBe('auto')
    expect(migrated.people[0]).toMatchObject({ pay_type: 'salary', salary: 91000, k401_pct: 6, user_id: 'u1' })
    expect(migrated.cats[0]).toMatchObject({ name: 'Rent', mode: 'fixed', amt: 2100, fold_category_id: 'abc' })
    expect(migrated.alloc.living).toBe(50)
    // v3 passes through untouched values; junk returns null.
    expect(migratePlanState(migrated)!.people[0].salary).toBe(91000)
    expect(migratePlanState({ v: 9 })).toBeNull()
    expect(migratePlanState('nope')).toBeNull()
  })

  it('folds a v2 per-interval amount into an annual salary and keeps the rhythm as the frequency', () => {
    const v2 = {
      v: 2,
      people: [
        { user_id: 'u1', name: 'Jake', color: '#8b5cf6', gross_amount: 3500, gross_per: 'biweekly', k401_pct: 6, manual_tax_pct: 22, items: [] },
        { user_id: null, name: 'Sam', color: '#0ea5e9', gross_amount: 4000, gross_per: 'mo', k401_pct: 0, manual_tax_pct: 18, items: [] },
      ],
    }
    const migrated = migratePlanState(v2)!
    expect(migrated.v).toBe(3)
    expect(migrated.people[0]).toMatchObject({ pay_type: 'salary', salary: 91000, pay_freq: 'biweekly' })
    expect(migrated.people[1]).toMatchObject({ salary: 48000, pay_freq: 'monthly' })
    expect(planPerCheck(migrated.people[0])).toBeCloseTo(3500, 6)
    // The gross is identical before and after the fold.
    expect(planAnnualGross(migrated.people[0])).toBe(91000)
  })
})
