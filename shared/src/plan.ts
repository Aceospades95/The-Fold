/**
 * The Plan sandbox: model the whole money picture — gross pay through taxes to
 * a shared take-home pool, then split the pool — without touching the tracked
 * budget. Everything here is pure math over a PlanState so the UI can
 * recalculate on every slider move and scenarios can snapshot the state.
 *
 * Amounts are DOLLARS (per paycheck for incomes, monthly for categories) —
 * this is a planning surface, not a ledger; the tracked side stays in cents.
 */

export type PlanDeductionType = 's125' | 'hsa' | 'pretax' | 'posttax'
export type PlanFiling = 'mfj' | 'single'
export type PlanAllocKey = 'living' | 'savings' | 'invest' | 'trip' | 'personal'
export type PlanPayPer = 'yr' | 'mo' | 'semimonthly' | 'biweekly' | 'weekly'

/** Paychecks per year for each frequency. */
export const PLAN_PAY_FACTOR: Record<PlanPayPer, number> = {
  yr: 1,
  mo: 12,
  semimonthly: 24,
  biweekly: 26,
  weekly: 52,
}

export const PLAN_PAY_LABELS: Record<PlanPayPer, string> = {
  yr: 'per year',
  mo: 'per month',
  semimonthly: 'twice a month',
  biweekly: 'every other week',
  weekly: 'every week',
}

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
  /** Gross pay in dollars, per `gross_per` (e.g. 3500 every other week). */
  gross_amount: number
  gross_per: PlanPayPer
  /** Traditional 401(k) as a percent of gross. Zero = none. */
  k401_pct: number
  /** Effective total tax rate (fed+state+FICA) when tax_mode is 'manual'. */
  manual_tax_pct: number
  items: PlanDeduction[]
}

export interface PlanCategory {
  id: string
  name: string
  /** 'fixed' = amt is monthly dollars; 'pct' = amt is a percent of take-home. */
  mode: 'fixed' | 'pct'
  amt: number
  /** Percent of the benefit that goes to person A (0–100). */
  benefit_a: number
  /** Linked real category, when pulled from actuals — powers plan-vs-actual. */
  fold_category_id?: string | null
}

export interface PlanState {
  v: 2
  filing: PlanFiling
  /** 'auto' = 2026 brackets + FICA; 'manual' = each person's own flat rate. */
  tax_mode: 'auto' | 'manual'
  /** Flat state income tax, percent (auto mode). */
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

export function planAnnualGross(person: PlanPerson): number {
  return (Number(person.gross_amount) || 0) * PLAN_PAY_FACTOR[person.gross_per]
}

/** Monthly dollars a category claims, given the pool. */
export function planCatMonthly(cat: PlanCategory, poolMo: number): number {
  const value = Number(cat.amt) || 0
  return cat.mode === 'pct' ? (value / 100) * poolMo : value
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
  /** This person's slice of federal+state income tax (or their whole manual tax). */
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
  /** Effective monthly dollars per planned category (parallel to state.cats). */
  cat_monthly: number[]
  cat_sum: number
  /** living bucket − planned categories (negative = plan overshoots the bucket). */
  buffer: number
}

export function computePlan(state: PlanState): PlanMath {
  const per = state.people.map((person) => {
    const gross = planAnnualGross(person)
    const k401 = (gross * (Number(person.k401_pct) || 0)) / 100
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
    const fw = Math.max(0, gross - incomeExempt)
    const ficaBase = Math.max(0, gross - ficaExempt)
    const fica =
      state.tax_mode === 'manual' ? 0 : SS_RATE * Math.min(ficaBase, SS_WAGE_BASE_2026) + MEDICARE_RATE * ficaBase
    return { gross, k401, income_exempt: incomeExempt, fica_exempt: ficaExempt, post, health, fw, fica }
  }) as [Omit<PlanPersonMath, 'share_tax' | 'contrib' | 'share'>, Omit<PlanPersonMath, 'share_tax' | 'contrib' | 'share'>]

  const gross = per[0].gross + per[1].gross
  const pre = per[0].income_exempt + per[1].income_exempt
  const post = per[0].post + per[1].post
  const fwTotal = per[0].fw + per[1].fw

  let taxable: number
  let fed: number
  let stateTax: number
  let manualTaxes: [number, number] = [0, 0]
  if (state.tax_mode === 'manual') {
    // Each person's own effective rate on their gross — fed, state, and FICA in one number.
    manualTaxes = [
      (per[0].gross * (Number(state.people[0].manual_tax_pct) || 0)) / 100,
      (per[1].gross * (Number(state.people[1].manual_tax_pct) || 0)) / 100,
    ]
    taxable = fwTotal
    fed = manualTaxes[0] + manualTaxes[1]
    stateTax = 0
  } else if (state.filing === 'mfj') {
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

  const people = per.map((p, index) => {
    const share_tax =
      state.tax_mode === 'manual' ? manualTaxes[index] : fwTotal > 0 ? ((fed + stateTax) * p.fw) / fwTotal : 0
    const contrib = p.gross - p.income_exempt - p.post - p.fica - share_tax
    return { ...p, share_tax, contrib, share: pool > 0 ? contrib / pool : 0.5 }
  }) as [PlanPersonMath, PlanPersonMath]

  const alloc = {} as Record<PlanAllocKey, number>
  for (const key of PLAN_ALLOC_KEYS) alloc[key] = ((state.alloc[key] ?? 0) / 100) * pool_mo
  const personal_a = state.personal_mode === 'equal' ? alloc.personal / 2 : alloc.personal * people[0].share
  const personal_b = alloc.personal - personal_a
  const cat_monthly = state.cats.map((c) => planCatMonthly(c, pool_mo))
  const cat_sum = cat_monthly.reduce((sum, v) => sum + v, 0)

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
    cat_monthly,
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
      (sum, c, i) => sum + (math.cat_monthly[i] * (index === 0 ? c.benefit_a : 100 - c.benefit_a)) / 100,
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
    v: 2,
    filing: 'mfj',
    tax_mode: 'auto',
    state_rate: 4.95,
    std_ded: STD_DED_MFJ_2026,
    people: [
      { user_id: null, name: 'You', color: '#8b5cf6', gross_amount: 85000, gross_per: 'yr', k401_pct: 6, manual_tax_pct: 22, items: [] },
      { user_id: null, name: 'Partner', color: '#0ea5e9', gross_amount: 70000, gross_per: 'yr', k401_pct: 5, manual_tax_pct: 20, items: [] },
    ],
    alloc: { living: 62, savings: 12, invest: 8, trip: 4, personal: 14 },
    cats: [],
    personal_mode: 'equal',
    trip_goal: 6000,
  }
}

/** Adopt any stored plan (v1 annual-gross states included) into the v2 shape. */
export function migratePlanState(input: unknown): PlanState | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (raw.v !== 1 && raw.v !== 2) return null
  const base = defaultPlanState()
  const people = (Array.isArray(raw.people) ? raw.people : []).slice(0, 2).map((p, index) => {
    const person = (p ?? {}) as Record<string, unknown>
    const fallback = base.people[index]
    return {
      user_id: typeof person.user_id === 'string' ? person.user_id : null,
      name: typeof person.name === 'string' && person.name ? person.name : fallback.name,
      color: typeof person.color === 'string' && person.color ? person.color : fallback.color,
      gross_amount:
        typeof person.gross_amount === 'number'
          ? person.gross_amount
          : typeof person.gross === 'number' // v1: annual `gross`
            ? person.gross
            : fallback.gross_amount,
      gross_per: (person.gross_per as PlanPayPer) in PLAN_PAY_FACTOR ? (person.gross_per as PlanPayPer) : 'yr',
      k401_pct: typeof person.k401_pct === 'number' ? person.k401_pct : fallback.k401_pct,
      manual_tax_pct: typeof person.manual_tax_pct === 'number' ? person.manual_tax_pct : fallback.manual_tax_pct,
      items: Array.isArray(person.items) ? (person.items as PlanDeduction[]) : [],
    }
  })
  while (people.length < 2) people.push(base.people[people.length])
  const cats = (Array.isArray(raw.cats) ? raw.cats : []).map((c) => {
    const cat = (c ?? {}) as Record<string, unknown>
    return {
      id: typeof cat.id === 'string' ? cat.id : planId(),
      name: typeof cat.name === 'string' ? cat.name : '',
      mode: cat.mode === 'pct' ? ('pct' as const) : ('fixed' as const),
      amt: typeof cat.amt === 'number' ? cat.amt : 0,
      benefit_a: typeof cat.benefit_a === 'number' ? cat.benefit_a : 50,
      fold_category_id: typeof cat.fold_category_id === 'string' ? cat.fold_category_id : null,
    }
  })
  return {
    v: 2,
    filing: raw.filing === 'single' ? 'single' : 'mfj',
    tax_mode: raw.tax_mode === 'manual' ? 'manual' : 'auto',
    state_rate: typeof raw.state_rate === 'number' ? raw.state_rate : base.state_rate,
    std_ded: typeof raw.std_ded === 'number' ? raw.std_ded : base.std_ded,
    people: people as [PlanPerson, PlanPerson],
    alloc: { ...base.alloc, ...(typeof raw.alloc === 'object' && raw.alloc ? (raw.alloc as Record<PlanAllocKey, number>) : {}) },
    cats,
    personal_mode: raw.personal_mode === 'prop' ? 'prop' : 'equal',
    trip_goal: typeof raw.trip_goal === 'number' ? raw.trip_goal : base.trip_goal,
  }
}
