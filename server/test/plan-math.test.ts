import { describe, expect, it } from 'vitest'
import {
  PLAN_ALLOC_KEYS,
  type PlanState,
  computePlan,
  defaultPlanState,
  fairness,
  federalTax,
  planId,
  rebalanceAlloc,
} from '@fold/shared'

function base(): PlanState {
  const state = defaultPlanState()
  state.people[0] = { ...state.people[0], gross: 85000, k401_pct: 0, items: [] }
  state.people[1] = { ...state.people[1], gross: 70000, k401_pct: 0, items: [] }
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

describe('computePlan', () => {
  it('caps Social Security at the wage base', () => {
    const state = base()
    state.people[0].gross = 200_000
    state.people[1].gross = 0
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
    // Same income-tax treatment, different FICA: the §125 person pays less FICA.
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
    married.people[0].gross = 150_000
    married.people[1].gross = 0
    const single = { ...married, filing: 'single' as const }
    expect(computePlan(married).tax).toBeLessThan(computePlan(single).tax)
  })

  it('splits personal allowances equally or by contribution share', () => {
    const state = base()
    state.alloc = { living: 60, savings: 10, invest: 10, trip: 6, personal: 14 }
    const equal = computePlan(state)
    expect(equal.personal_a).toBeCloseTo(equal.personal_b, 6)
    state.personal_mode = 'prop'
    const prop = computePlan(state)
    expect(prop.personal_a).toBeGreaterThan(prop.personal_b) // 85k earner gets more
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
      { id: planId(), name: 'Rent', amt: 2000, benefit_a: 50 },
      { id: planId(), name: 'Car', amt: 400, benefit_a: 80 },
    ]
    const math = computePlan(state)
    const { puts, gets } = fairness(state, math)
    expect(puts[0] + puts[1]).toBeCloseTo(math.pool_mo, 4)
    expect(gets[0] + gets[1]).toBeCloseTo(math.pool_mo, 4)
    // The 80/20 car line tilts person A's gets above person B's shared slice.
    expect(gets[0]).toBeGreaterThan(gets[1])
  })
})
