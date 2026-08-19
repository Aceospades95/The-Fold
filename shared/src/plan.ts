/**
 * The Plan sandbox: model the whole money picture — gross pay through taxes to
 * a shared take-home pool, then split the pool — without touching the tracked
 * budget. Everything here is pure math over a PlanState so the UI can
 * recalculate on every slider move and scenarios can snapshot the state.
 *
 * Amounts are DOLLARS (annual for incomes, monthly for categories) — this is a
 * planning surface, not a ledger; the tracked side of the app stays in cents.
 */

export type PlanDeductionType = 's125' | 'hsa' | 'pretax' | 'posttax'
export type PlanFiling = 'mfj' | 'single'
export type PlanAllocKey = 'living' | 'savings' | 'invest' | 'trip' | 'personal'

export interface PlanDeduction {
  id: string
  name: string
  /** Dollars, per `per`. */
  amt: number
  per: 'mo' | 'yr'
  type: PlanDeductionType
}

export interface PlanPerson {
  /** Linked household member, when seeded from the real household. */
  user_id: string | null
  name: string
  color: string
  /** Gross annual salary, dollars. */
  gross: number
  /** Traditional 401(k) as a percent of gross. */
  k401_pct: number
  items: PlanDeduction[]
}

export interface PlanCategory {
  id: string
  name: string
  /** Monthly dollars. */
  amt: number
  /** Percent of the benefit that goes to person A (0–100). */
  benefit_a: number
  /** Linked real category, when pulled from actuals — powers plan-vs-actual. */
  fold_category_id?: string | null
}

export interface PlanState {
  v: 1
  filing: PlanFiling
  /** Flat state income tax, percent. */
  state_rate: number
  /** Federal deduction for the couple (halved per person when filing single). */
  std_ded: number
  people: [PlanPerson, PlanPerson]
  /** Percent of the take-home pool per bucket; always sums to 100. */
  alloc: Record<PlanAllocKey, number>
  cats: PlanCategory[]
  personal_mode: 'equal' | 'prop'
  trip_goal: number
}

export const PLAN_ALLOC_KEYS: PlanAllocKey[] = ['living', 'savings', 'invest', 'trip', 'personal']

export const PLAN_DED_TYPES: Record<PlanDeductionType, { label: string; income_exempt: boolean; fica_exempt: boolean }> = {
  s125: { label: 'Medical/dental/vision — pre-tax + FICA-free', income_exempt: true, fica_exempt: true },
  hsa: { label: 'HSA / FSA via payroll — pre-tax + FICA-free', income_exempt: true, fica_exempt: true },
  pretax: { label: 'Other pre-tax — income tax only', income_exempt: true, fica_exempt: false },
  posttax: { label: 'Post-tax (Roth 401k, life ins…)', income_exempt: false, fica_exempt: false },
}

// --- 2026 tax law (IRS tax-year-2026 inflation adjustments) -----------------
export const STD_DED_MFJ_2026 = 32200
export const STD_DED_SINGLE_2026 = 16100
const BRACKETS_MFJ: [number, number][] = [
  [0, 0.1], [24800, 0.12], [100800, 0.22], [211400, 0.24], [403550, 0.32], [512450, 0.35], [768700, 0.37],
]
const BRACKETS_SINGLE: [number, number][] = [
  [0, 0.1], [12400, 0.12], [50400, 0.22], [105700, 0.24], [201775, 0.32], [256225, 0.35], [640600, 0.37],
]
export const SS_WAGE_BASE_2026 = 184500
const SS_RATE = 0.062
const MEDICARE_RATE = 0.0145

export function federalTax(taxable: number, filing: PlanFiling): number {
  const brackets = filing === 'mfj' ? BRACKETS_MFJ : BRACKETS_SINGLE
  let tax = 0
  for (let i = 0; i < brackets.length; i++) {
    const [lo, rate] = brackets[i]
    const hi = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity
    if (taxable > lo) tax += (Math.min(taxable, hi) - lo) * rate
  }
  return tax
}

const deductionYearly = (item: PlanDeduction): number => (Number(item.amt) || 0) * (item.per === 'mo' ? 12 : 1)

export interface PlanPersonMath {
  gross: number
  k401: number
  /** Income-tax-exempt payroll deductions (401k + pre-tax items), yearly. */
  income_exempt: number
  /** FICA-exempt portion (§125 / HSA lines), yearly. */
  fica_exempt: number
  post: number
  health: number
  /** Federal wages after income-exempt deductions. */
  fw: number
  fica: number
  /** This person's slice of federal+state income tax, by federal-wage share. */
  share_tax: number
  /** What actually lands in the pool from this person, yearly. */
  contrib: number
  /** contrib as a share of the pool (0–1). */
  share: number
}

export interface PlanMath {
  people: [PlanPersonMath, PlanPersonMath]
  gross: number
  pre: number
  post: number
  taxable: number
  fed: number
  state: number
  fica: number
  tax: number
  /** Yearly and monthly take-home pool. */
  pool: number
  pool_mo: number
  /** Monthly dollars per bucket. */
  alloc: Record<PlanAllocKey, number>
  personal_a: number
  personal_b: number
  cat_sum: number
  /** living bucket − planned categories (negative = plan overshoots the bucket). */
  buffer: number
}

export function computePlan(state: PlanState): PlanMath {
  const per = state.people.map((person) => {
    const k401 = (person.gross * (Number(person.k401_pct) || 0)) / 100
    let incomeExempt = k401
    let ficaExempt = 0
    let post = 0
    let health = 0
    for (const item of person.items) {
      const yearly = deductionYearly(item)
      const treatment = PLAN_DED_TYPES[item.type] ?? PLAN_DED_TYPES.pretax
      if (treatment.income_exempt) incomeExempt += yearly
      if (treatment.fica_exempt) {
        ficaExempt += yearly
        health += yearly
      }
      if (!treatment.income_exempt && !treatment.fica_exempt) post += yearly
    }
    const fw = Math.max(0, person.gross - incomeExempt)
    const ficaBase = Math.max(0, person.gross - ficaExempt)
    const fica = SS_RATE * Math.min(ficaBase, SS_WAGE_BASE_2026) + MEDICARE_RATE * ficaBase
    return { gross: person.gross, k401, income_exempt: incomeExempt, fica_exempt: ficaExempt, post, health, fw, fica }
  }) as [Omit<PlanPersonMath, 'share_tax' | 'contrib' | 'share'>, Omit<PlanPersonMath, 'share_tax' | 'contrib' | 'share'>]

  const gross = per[0].gross + per[1].gross
  const pre = per[0].income_exempt + per[1].income_exempt
  const post = per[0].post + per[1].post
  const fwTotal = per[0].fw + per[1].fw

  let taxable: number
  let fed: number
  let stateTax: number
  if (state.filing === 'mfj') {
    taxable = Math.max(0, fwTotal - state.std_ded)
    fed = federalTax(taxable, 'mfj')
    stateTax = (state.state_rate / 100) * taxable
  } else {
    // Two single filers: each gets half the couple's deduction, taxed separately.
    const each = per.map((p) => Math.max(0, p.fw - state.std_ded / 2))
    taxable = each[0] + each[1]
    fed = federalTax(each[0], 'single') + federalTax(each[1], 'single')
    stateTax = (state.state_rate / 100) * taxable
  }
  const fica = per[0].fica + per[1].fica
  const tax = fed + stateTax + fica
  const pool = gross - pre - post - tax
  const pool_mo = pool / 12

  const people = per.map((p) => {
    const share_tax = fwTotal > 0 ? ((fed + stateTax) * p.fw) / fwTotal : 0
    const contrib = p.gross - p.income_exempt - p.post - p.fica - share_tax
    return { ...p, share_tax, contrib, share: pool > 0 ? contrib / pool : 0.5 }
  }) as [PlanPersonMath, PlanPersonMath]

  const alloc = {} as Record<PlanAllocKey, number>
  for (const key of PLAN_ALLOC_KEYS) alloc[key] = ((state.alloc[key] ?? 0) / 100) * pool_mo
  const personal_a = state.personal_mode === 'equal' ? alloc.personal / 2 : alloc.personal * people[0].share
  const personal_b = alloc.personal - personal_a
  const cat_sum = state.cats.reduce((sum, c) => sum + (Number(c.amt) || 0), 0)

  return {
    people,
    gross,
    pre,
    post,
    taxable,
    fed,
    state: stateTax,
    fica,
    tax,
    pool,
    pool_mo,
    alloc,
    personal_a,
    personal_b,
    cat_sum,
    buffer: alloc.living - cat_sum,
  }
}

/**
 * Move one bucket to `value` percent and scale the others so the five always
 * total exactly 100 — the drag-one-the-rest-rebalance behavior.
 */
export function rebalanceAlloc(
  alloc: Record<PlanAllocKey, number>,
  changed: PlanAllocKey,
  value: number,
): Record<PlanAllocKey, number> {
  const next = { ...alloc }
  const clamped = Math.min(100, Math.max(0, value))
  const others = PLAN_ALLOC_KEYS.filter((k) => k !== changed)
  const oldOthers = 100 - (next[changed] ?? 0)
  const newOthers = 100 - clamped
  if (oldOthers <= 0.0001) {
    for (const k of others) next[k] = newOthers / others.length
  } else {
    const factor = newOthers / oldOthers
    for (const k of others) next[k] = (next[k] ?? 0) * factor
  }
  next[changed] = clamped
  const drift = 100 - PLAN_ALLOC_KEYS.reduce((sum, k) => sum + (next[k] ?? 0), 0)
  const biggest = [...others].sort((a, b) => (next[b] ?? 0) - (next[a] ?? 0))[0]
  next[biggest] = Math.max(0, (next[biggest] ?? 0) + drift)
  return next
}

/** Fairness view: what each person puts into the pool vs what flows back. */
export function fairness(state: PlanState, math: PlanMath): {
  puts: [number, number]
  gets: [number, number]
} {
  const getsShared = (index: 0 | 1): number =>
    state.cats.reduce(
      (sum, c) => sum + ((Number(c.amt) || 0) * (index === 0 ? c.benefit_a : 100 - c.benefit_a)) / 100,
      0,
    ) +
    math.buffer / 2
  const halfJoint = (math.alloc.savings + math.alloc.invest + math.alloc.trip) / 2
  return {
    puts: [math.people[0].contrib / 12, math.people[1].contrib / 12],
    gets: [getsShared(0) + math.personal_a + halfJoint, getsShared(1) + math.personal_b + halfJoint],
  }
}

let planIdCounter = 1
export const planId = (): string => `p${planIdCounter++}_${Math.random().toString(36).slice(2, 7)}`

export function defaultPlanState(): PlanState {
  return {
    v: 1,
    filing: 'mfj',
    state_rate: 4.95,
    std_ded: STD_DED_MFJ_2026,
    people: [
      { user_id: null, name: 'You', color: '#8b5cf6', gross: 85000, k401_pct: 6, items: [] },
      { user_id: null, name: 'Partner', color: '#10b981', gross: 70000, k401_pct: 5, items: [] },
    ],
    alloc: { living: 62, savings: 12, invest: 8, trip: 4, personal: 14 },
    cats: [],
    personal_mode: 'equal',
    trip_goal: 6000,
  }
}
