import { describe, expect, it } from 'vitest'
import {
  PLAN_ALLOC_KEYS,
  type PlanState,
  computePlan,
  defaultPlanState,
  fairness,
  federalTax,
  migratePlanState,
  planAnnualGross,
  planId,
  rebalanceAlloc,
} from '@fold/shared'

function base(): PlanState {
  const state = defaultPlanState()
  state.people[0] = { ...state.people[0], gross_amount: 85000, gross_per: 'yr', k401_pct: 0, items: [] }
  state.people[1] = { ...state.people[1], gross_amount: 70000, gross_per: 'yr', k401_pct: 0, items: [] }
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

describe('pay frequency', () => {
  it('annualizes each cadence correctly', () => {
    const p = base().people[0]
    expect(planAnnualGross({ ...p, gross_amount: 3500, gross_per: 'biweekly' })).toBe(91_000)
    expect(planAnnualGross({ ...p, gross_amount: 4000, gross_per: 'semimonthly' })).toBe(96_000)
    expect(planAnnualGross({ ...p, gross_amount: 1500, gross_per: 'weekly' })).toBe(78_000)
    expect(planAnnualGross({ ...p, gross_amount: 7000, gross_per: 'mo' })).toBe(84_000)
  })

  it('a biweekly paycheck and its annual equivalent produce the same plan', () => {
    const yearly = base()
    yearly.people[0].gross_amount = 91_000
    const biweekly = base()
    biweekly.people[0].gross_amount = 3500
    biweekly.people[0].gross_per = 'biweekly'
    expect(computePlan(biweekly).pool).toBeCloseTo(computePlan(yearly).pool, 4)
  })
})

describe('computePlan', () => {
  it('caps Social Security at the wage base', () => {
    const state = base()
    state.people[0].gross_amount = 200_000
    state.people[1].gross_amount = 0
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
    married.people[0].gross_amount = 150_000
    married.people[1].gross_amount = 0
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
    state.people[0].gross_amount = 170_000
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
  it('adopts a v1 state (annual gross, plain cats) into v2 without losing numbers', () => {
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
    expect(migrated.v).toBe(2)
    expect(migrated.tax_mode).toBe('auto')
    expect(migrated.people[0]).toMatchObject({ gross_amount: 91000, gross_per: 'yr', k401_pct: 6, user_id: 'u1' })
    expect(migrated.cats[0]).toMatchObject({ name: 'Rent', mode: 'fixed', amt: 2100, fold_category_id: 'abc' })
    expect(migrated.alloc.living).toBe(50)
    // v2 passes through untouched values; junk returns null.
    expect(migratePlanState(migrated)!.people[0].gross_amount).toBe(91000)
    expect(migratePlanState({ v: 9 })).toBeNull()
    expect(migratePlanState('nope')).toBeNull()
  })
})
