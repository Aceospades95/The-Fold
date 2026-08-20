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
export type PlanPayType = 'salary' | 'hourly'
export type PlanPayFreq = 'monthly' | 'semimonthly' | 'biweekly' | 'weekly'

/** Paychecks per year for each pay frequency. */
export const PLAN_FREQ_FACTOR: Record<PlanPayFreq, number> = {
  monthly: 12,
  semimonthly: 24,
  biweekly: 26,
  weekly: 52,
}

export const PLAN_FREQ_LABELS: Record<PlanPayFreq, string> = {
  monthly: 'once a month',
  semimonthly: 'twice a month',
  biweekly: 'every other week',
  weekly: 'every week',
}

/** Legacy v1/v2 "amount per interval" unit — kept only so old states migrate. */
export type PlanPayPer = 'yr' | 'mo' | 'semimonthly' | 'biweekly' | 'weekly'
const LEGACY_PAY_FACTOR: Record<PlanPayPer, number> = { yr: 1, mo: 12, semimonthly: 24, biweekly: 26, weekly: 52 }
const LEGACY_PER_TO_FREQ: Record<PlanPayPer, PlanPayFreq> = {
  yr: 'biweekly',
  mo: 'monthly',
  semimonthly: 'semimonthly',
  biweekly: 'biweekly',
  weekly: 'weekly',
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
  /** How this person is paid: a yearly salary, or an hourly rate × hours. */
  pay_type: PlanPayType
  /** Annual gross salary in dollars (pay_type 'salary'). */
  salary: number
  /** Dollars per hour (pay_type 'hourly'). */
  hourly_rate: number
  /** Scheduled hours per week (pay_type 'hourly'). */
  hours_per_week: number
  /** How paychecks actually arrive — drives every per-paycheck figure. */
  pay_freq: PlanPayFreq
  /** Any real payday (YYYY-MM-DD) — anchors which months get an extra check. */
  next_payday: string | null
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

/** A custom set-aside slice of the pool (savings, investments, a fund…). */
export interface PlanBucket {
  id: string
  name: string
  /** Percent of the take-home pool. */
  pct: number
  /** Optional dollar goal — powers the "≈ n months" ETA. */
  goal: number | null
}

export interface PlanState {
  v: 4
  filing: PlanFiling
  /** 'auto' = 2026 brackets + FICA; 'manual' = each person's own flat rate. */
  tax_mode: 'auto' | 'manual'
  /** Flat state income tax, percent (auto mode). */
  state_rate: number
  /** Federal deduction for the couple (halved per person when filing single). */
  std_ded: number
  people: [PlanPerson, PlanPerson]
  /**
   * The pool splits three ways: living expenses (itemized by `cats`), any
   * number of custom set-aside buckets, and personal allowances.
   * living_pct + Σ buckets.pct + personal_pct always totals 100.
   */
  living_pct: number
  personal_pct: number
  buckets: PlanBucket[]
  /** Slice keys pinned in place — 'living', 'personal', or a bucket id. */
  bucket_locked: string[]
  cats: PlanCategory[]
  personal_mode: 'equal' | 'prop'
}

/** The fixed slice keys around the custom buckets. */
export const PLAN_LIVING = 'living'
export const PLAN_PERSONAL = 'personal'

export const PLAN_DED_TYPES: Record<PlanDeductionType, { label: string; income_exempt: boolean; fica_exempt: boolean }> = {
  s125: { label: 'Pre-tax · no FICA (health)', income_exempt: true, fica_exempt: true },
  hsa: { label: 'Pre-tax · no FICA (HSA/FSA)', income_exempt: true, fica_exempt: true },
  pretax: { label: 'Pre-tax', income_exempt: true, fica_exempt: false },
  posttax: { label: 'Post-tax', income_exempt: false, fica_exempt: false },
}

export function planAnnualGross(person: PlanPerson): number {
  if (person.pay_type === 'hourly') {
    return (Number(person.hourly_rate) || 0) * (Number(person.hours_per_week) || 0) * 52
  }
  return Number(person.salary) || 0
}

/** Gross dollars in one paycheck at this person's pay frequency. */
export function planPerCheck(person: PlanPerson): number {
  return planAnnualGross(person) / PLAN_FREQ_FACTOR[person.pay_freq]
}

/**
 * How many paydays land inside a YYYY-MM month. Biweekly/weekly rhythms need
 * an anchor date — `next_payday` when set, else the year's first Friday.
 */
export function checksInMonth(person: PlanPerson, month: string): number {
  if (person.pay_freq === 'monthly') return 1
  if (person.pay_freq === 'semimonthly') return 2
  const stepMs = (person.pay_freq === 'weekly' ? 7 : 14) * 86400000
  const [y, m] = month.split('-').map(Number)
  const start = Date.UTC(y, m - 1, 1)
  const end = Date.UTC(y, m, 1)
  let anchor = person.next_payday ? Date.parse(`${person.next_payday}T00:00:00Z`) : NaN
  if (!Number.isFinite(anchor)) {
    const jan1 = new Date(Date.UTC(y, 0, 1))
    anchor = Date.UTC(y, 0, 1 + ((5 - jan1.getUTCDay() + 7) % 7))
  }
  // First payday of the series on/after the month start, then count the hops.
  const rem = (((start - anchor) % stepMs) + stepMs) % stepMs
  let t = rem === 0 ? start : start + stepMs - rem
  let count = 0
  while (t < end) {
    count += 1
    t += stepMs
  }
  return count
}

/** Gross dollars actually arriving in one specific month. */
export function planMonthGross(person: PlanPerson, month: string): number {
  return planPerCheck(person) * checksInMonth(person, month)
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
  /** Monthly dollars for the fixed slices and each custom bucket (parallel to state.buckets). */
  living_mo: number
  personal_mo: number
  buckets_mo: number[]
  personal_a: number
  personal_b: number
  /** Effective monthly dollars per planned category (parallel to state.cats). */
  cat_monthly: number[]
  cat_sum: number
  /** living slice − planned categories (negative = plan overshoots the slice). */
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

  const living_mo = ((Number(state.living_pct) || 0) / 100) * pool_mo
  const personal_mo = ((Number(state.personal_pct) || 0) / 100) * pool_mo
  const buckets_mo = state.buckets.map((b) => ((Number(b.pct) || 0) / 100) * pool_mo)
  const personal_a = state.personal_mode === 'equal' ? personal_mo / 2 : personal_mo * people[0].share
  const personal_b = personal_mo - personal_a
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
    living_mo,
    personal_mo,
    buckets_mo,
    personal_a,
    personal_b,
    cat_monthly,
    cat_sum,
    buffer: living_mo - cat_sum,
  }
}

/**
 * Move one slice to `value` percent and scale the unlocked others so the whole
 * split always totals exactly 100 — the drag-one-the-rest-rebalance behavior.
 * Works over any key set (living, personal, and every custom bucket id).
 */
export function rebalanceSplit(
  values: Record<string, number>,
  keys: string[],
  changed: string,
  value: number,
  locked: string[] = [],
): Record<string, number> {
  const next = { ...values }
  const lockedSet = new Set(locked.filter((k) => k !== changed))
  const lockedSum = [...lockedSet].reduce((sum, k) => sum + (next[k] ?? 0), 0)
  const others = keys.filter((k) => k !== changed && !lockedSet.has(k))
  if (others.length === 0) {
    next[changed] = Math.max(0, 100 - lockedSum)
    return next
  }
  const clamped = Math.min(100 - lockedSum, Math.max(0, value))
  const oldOthers = others.reduce((sum, k) => sum + (next[k] ?? 0), 0)
  const newOthers = 100 - lockedSum - clamped
  if (oldOthers <= 0.0001) {
    for (const k of others) next[k] = newOthers / others.length
  } else {
    const factor = newOthers / oldOthers
    for (const k of others) next[k] = (next[k] ?? 0) * factor
  }
  next[changed] = clamped
  const drift = 100 - keys.reduce((sum, k) => sum + (next[k] ?? 0), 0)
  const biggest = [...others].sort((a, b) => (next[b] ?? 0) - (next[a] ?? 0))[0]
  next[biggest] = Math.max(0, (next[biggest] ?? 0) + drift)
  return next
}

/** Apply a rebalanced value straight onto a PlanState draft. */
export function setSplitValue(state: PlanState, changed: string, value: number): void {
  const keys = [PLAN_LIVING, ...state.buckets.map((b) => b.id), PLAN_PERSONAL]
  const values: Record<string, number> = { living: state.living_pct, personal: state.personal_pct }
  for (const bucket of state.buckets) values[bucket.id] = bucket.pct
  const next = rebalanceSplit(values, keys, changed, value, state.bucket_locked)
  state.living_pct = next.living
  state.personal_pct = next.personal
  for (const bucket of state.buckets) bucket.pct = next[bucket.id] ?? 0
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
  const halfJoint = math.buckets_mo.reduce((sum, v) => sum + v, 0) / 2
  return {
    puts: [math.people[0].contrib / 12, math.people[1].contrib / 12],
    gets: [getsShared(0) + math.personal_a + halfJoint, getsShared(1) + math.personal_b + halfJoint],
  }
}

let planIdCounter = 1
export const planId = (): string => `p${planIdCounter++}_${Math.random().toString(36).slice(2, 7)}`

function defaultPerson(name: string, color: string, salary: number, k401: number, tax: number): PlanPerson {
  return {
    user_id: null,
    name,
    color,
    pay_type: 'salary',
    salary,
    hourly_rate: Math.round((salary / 2080) * 100) / 100,
    hours_per_week: 40,
    pay_freq: 'biweekly',
    next_payday: null,
    k401_pct: k401,
    manual_tax_pct: tax,
    items: [],
  }
}

export function defaultBuckets(tripGoal: number | null = 6000): PlanBucket[] {
  return [
    { id: planId(), name: 'Savings', pct: 12, goal: null },
    { id: planId(), name: 'Investments', pct: 8, goal: null },
    { id: planId(), name: 'Trip fund', pct: 4, goal: tripGoal },
  ]
}

export function defaultPlanState(): PlanState {
  return {
    v: 4,
    filing: 'mfj',
    tax_mode: 'auto',
    state_rate: 4.95,
    std_ded: STD_DED_MFJ_2026,
    people: [defaultPerson('You', '#8b5cf6', 85000, 6, 22), defaultPerson('Partner', '#0ea5e9', 70000, 5, 20)],
    living_pct: 62,
    personal_pct: 14,
    buckets: defaultBuckets(),
    bucket_locked: [],
    cats: [],
    personal_mode: 'equal',
  }
}

/** Adopt any stored plan (v1 annual-gross and v2 per-interval states included) into the v3 shape. */
export function migratePlanState(input: unknown): PlanState | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (raw.v !== 1 && raw.v !== 2 && raw.v !== 3 && raw.v !== 4) return null
  const base = defaultPlanState()
  const people = (Array.isArray(raw.people) ? raw.people : []).slice(0, 2).map((p, index) => {
    const person = (p ?? {}) as Record<string, unknown>
    const fallback = base.people[index]

    let salary: number
    let payFreq: PlanPayFreq =
      (person.pay_freq as PlanPayFreq) in PLAN_FREQ_FACTOR ? (person.pay_freq as PlanPayFreq) : 'biweekly'
    if (typeof person.salary === 'number') {
      salary = person.salary
    } else {
      // v2 stored "amount per interval"; v1 stored annual `gross`. Fold either
      // into an annual salary and carry the old interval over as the frequency.
      const per: PlanPayPer =
        (person.gross_per as PlanPayPer) in LEGACY_PAY_FACTOR ? (person.gross_per as PlanPayPer) : 'yr'
      const amount =
        typeof person.gross_amount === 'number'
          ? person.gross_amount
          : typeof person.gross === 'number'
            ? person.gross
            : fallback.salary
      salary = Math.round(amount * LEGACY_PAY_FACTOR[per])
      if (typeof person.pay_freq !== 'string') payFreq = LEGACY_PER_TO_FREQ[per]
    }

    return {
      user_id: typeof person.user_id === 'string' ? person.user_id : null,
      name: typeof person.name === 'string' && person.name ? person.name : fallback.name,
      color: typeof person.color === 'string' && person.color ? person.color : fallback.color,
      pay_type: person.pay_type === 'hourly' ? ('hourly' as const) : ('salary' as const),
      salary,
      hourly_rate:
        typeof person.hourly_rate === 'number' ? person.hourly_rate : Math.round((salary / 2080) * 100) / 100,
      hours_per_week: typeof person.hours_per_week === 'number' ? person.hours_per_week : 40,
      pay_freq: payFreq,
      next_payday:
        typeof person.next_payday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(person.next_payday)
          ? person.next_payday
          : null,
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
  // Split: v4 states carry living/personal/buckets directly; older states fold
  // their fixed five-way alloc into three seeded buckets (trip keeps its goal).
  let livingPct: number
  let personalPct: number
  let buckets: PlanBucket[]
  let bucketLocked: string[]
  if (raw.v === 4) {
    const rawBuckets = Array.isArray(raw.buckets) ? raw.buckets : []
    buckets = rawBuckets.map((b) => {
      const bucket = (b ?? {}) as Record<string, unknown>
      return {
        id: typeof bucket.id === 'string' ? bucket.id : planId(),
        name: typeof bucket.name === 'string' && bucket.name ? bucket.name : 'Bucket',
        pct: typeof bucket.pct === 'number' ? bucket.pct : 0,
        goal: typeof bucket.goal === 'number' && bucket.goal > 0 ? bucket.goal : null,
      }
    })
    livingPct = typeof raw.living_pct === 'number' ? raw.living_pct : base.living_pct
    personalPct = typeof raw.personal_pct === 'number' ? raw.personal_pct : base.personal_pct
    const validKeys = new Set(['living', 'personal', ...buckets.map((b) => b.id)])
    bucketLocked = Array.isArray(raw.bucket_locked)
      ? (raw.bucket_locked.filter((k) => typeof k === 'string' && validKeys.has(k)) as string[])
      : []
  } else {
    const alloc = (typeof raw.alloc === 'object' && raw.alloc ? raw.alloc : {}) as Record<string, unknown>
    const pct = (key: string, fallback: number): number => (typeof alloc[key] === 'number' ? (alloc[key] as number) : fallback)
    const tripGoal = typeof raw.trip_goal === 'number' && raw.trip_goal > 0 ? raw.trip_goal : null
    const seeded: { legacy: string; name: string; pct: number; goal: number | null }[] = [
      { legacy: 'savings', name: 'Savings', pct: pct('savings', 12), goal: null },
      { legacy: 'invest', name: 'Investments', pct: pct('invest', 8), goal: null },
      { legacy: 'trip', name: 'Trip fund', pct: pct('trip', 4), goal: tripGoal },
    ]
    const legacyToId = new Map<string, string>()
    buckets = seeded.map((s) => {
      const id = planId()
      legacyToId.set(s.legacy, id)
      return { id, name: s.name, pct: s.pct, goal: s.goal }
    })
    livingPct = pct('living', base.living_pct)
    personalPct = pct('personal', base.personal_pct)
    bucketLocked = Array.isArray(raw.alloc_locked)
      ? (raw.alloc_locked
          .map((k) => (k === 'living' || k === 'personal' ? k : legacyToId.get(k as string)))
          .filter(Boolean) as string[])
      : []
  }

  return {
    v: 4,
    filing: raw.filing === 'single' ? 'single' : 'mfj',
    tax_mode: raw.tax_mode === 'manual' ? 'manual' : 'auto',
    state_rate: typeof raw.state_rate === 'number' ? raw.state_rate : base.state_rate,
    std_ded: typeof raw.std_ded === 'number' ? raw.std_ded : base.std_ded,
    people: people as [PlanPerson, PlanPerson],
    living_pct: livingPct,
    personal_pct: personalPct,
    buckets,
    bucket_locked: bucketLocked,
    cats,
    personal_mode: raw.personal_mode === 'prop' ? 'prop' : 'equal',
  }
}
