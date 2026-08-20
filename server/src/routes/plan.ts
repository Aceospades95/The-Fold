import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PlanPayFreq, PlanState } from '@fold/shared'
import {
  STD_DED_MFJ_2026,
  computePlan,
  defaultBuckets,
  migratePlanState,
  monthlyCents,
  planCatMonthly,
  planId,
  setSplitValue,
} from '@fold/shared'
import type { Cadence, PayDeduction } from '@fold/shared'
import { setAllocation } from './budget.js'
import { materializeMonth, saveBudgetDefault } from '../lib/defaults.js'
import { getMembers } from '../lib/queries.js'
import { getSetting, putSetting } from '../lib/webhooks.js'
import { badRequest, currentMonth, daysInMonth, id, monthRange, notFound, shiftMonth, today } from '../lib/util.js'

const PLAN_KEY = 'plan'
const SCENARIOS_KEY = 'plan_scenarios'
const MAX_SCENARIOS = 20

const deductionSchema = z.object({
  id: z.string().max(40),
  name: z.string().max(80),
  amt: z.number().min(0).max(10_000_000),
  per: z.enum(['mo', 'yr']),
  type: z.enum(['s125', 'hsa', 'pretax', 'posttax']),
})

const personSchema = z.object({
  user_id: z.string().max(60).nullable(),
  name: z.string().max(60),
  color: z.string().max(20),
  pay_type: z.enum(['salary', 'hourly']),
  salary: z.number().min(0).max(100_000_000),
  hourly_rate: z.number().min(0).max(100_000),
  hours_per_week: z.number().min(0).max(168),
  pay_freq: z.enum(['monthly', 'semimonthly', 'biweekly', 'weekly']),
  next_payday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().default(null),
  k401_pct: z.number().min(0).max(100),
  manual_tax_pct: z.number().min(0).max(80),
  items: z.array(deductionSchema).max(30),
})

const stateSchema = z.object({
  v: z.literal(4),
  filing: z.enum(['mfj', 'single']),
  tax_mode: z.enum(['auto', 'manual']),
  state_rate: z.number().min(0).max(20),
  std_ded: z.number().min(0).max(1_000_000),
  people: z.tuple([personSchema, personSchema]),
  living_pct: z.number().min(0).max(100),
  personal_pct: z.number().min(0).max(100),
  buckets: z
    .array(
      z.object({
        id: z.string().max(40),
        name: z.string().trim().min(1).max(60),
        pct: z.number().min(0).max(100),
        goal: z.number().min(0).max(100_000_000).nullable(),
      }),
    )
    .max(12),
  bucket_locked: z.array(z.string().max(40)).max(14).default([]),
  cats: z
    .array(
      z.object({
        id: z.string().max(40),
        name: z.string().max(80),
        mode: z.enum(['fixed', 'pct']),
        amt: z.number().min(0).max(10_000_000),
        benefit_a: z.number().min(0).max(100),
        fold_category_id: z.string().max(60).nullish(),
      }),
    )
    .max(80),
  personal_mode: z.enum(['equal', 'prop']),
})

interface StoredPlan {
  state: PlanState
  saved_at: string | null
  saved_by: string | null
}

interface StoredScenario {
  name: string
  state: PlanState
  saved_at: string
  saved_by: string
}

const CADENCE_TO_FREQ: Record<Cadence, PlanPayFreq> = {
  monthly: 'monthly',
  semimonthly: 'semimonthly',
  biweekly: 'biweekly',
  weekly: 'weekly',
  annual: 'monthly',
}

/**
 * Keep plan people in step with the real household: a person modeled before
 * their partner signed up ("Partner", no user_id) adopts the new member's
 * identity the moment one exists — numbers stay exactly as modeled.
 */
function reconcilePeople(app: FastifyInstance, householdId: string, state: PlanState): boolean {
  const members = getMembers(app.db, householdId)
  const claimed = new Set(state.people.map((p) => p.user_id).filter(Boolean))
  let changed = false
  for (const person of state.people) {
    if (person.user_id) {
      const member = members.find((m) => m.id === person.user_id)
      if (member) {
        const first = member.name.split(' ')[0]
        if (person.name !== first || person.color !== member.color) {
          person.name = first
          person.color = member.color
          changed = true
        }
      }
      continue
    }
    const free = members.find((m) => !claimed.has(m.id))
    if (free) {
      person.user_id = free.id
      person.name = free.name.split(' ')[0]
      person.color = free.color
      claimed.add(free.id)
      changed = true
    }
  }
  return changed
}

/** Seed a plan from the household's real incomes and shared categories. */
function bootstrapPlan(app: FastifyInstance, householdId: string): PlanState {
  const members = getMembers(app.db, householdId)
  const incomeRows = app.db
    .prepare(
      `SELECT i.user_id, i.amount_cents, i.gross_cents, i.deductions, i.cadence
       FROM income_sources i JOIN users u ON u.id = i.user_id
       WHERE u.household_id = ? AND i.active = 1`,
    )
    .all(householdId) as {
    user_id: string
    amount_cents: number
    gross_cents: number | null
    deductions: string | null
    cadence: Cadence
  }[]

  const people = [0, 1].map((index) => {
    const member = members[index]
    if (!member) {
      return {
        user_id: null,
        name: index === 0 ? 'You' : 'Partner',
        color: index === 0 ? '#8b5cf6' : '#0ea5e9',
        pay_type: 'salary' as const,
        salary: 0,
        hourly_rate: 0,
        hours_per_week: 40,
        pay_freq: 'biweekly' as PlanPayFreq,
        next_payday: null,
        k401_pct: 0,
        manual_tax_pct: 20,
        items: [],
      }
    }
    const sources = incomeRows.filter((r) => r.user_id === member.id)
    let annualGross = 0
    let k401Yearly = 0
    let taxYearly = 0
    const items: PlanState['people'][0]['items'] = []
    for (const source of sources) {
      annualGross += (monthlyCents(source.gross_cents ?? source.amount_cents, source.cadence) * 12) / 100
      const deductions = source.deductions ? (JSON.parse(source.deductions) as PayDeduction[]) : []
      for (const d of deductions) {
        const yearly = (monthlyCents(d.amount_cents, source.cadence) * 12) / 100
        if (d.kind === 'tax') {
          taxYearly += yearly
          continue // the plan computes taxes itself
        }
        if (/401|403/.test(d.name)) {
          k401Yearly += yearly
          continue
        }
        const isHealth = /med|dent|vision|health|hsa|fsa/i.test(d.name)
        items.push({
          id: planId(),
          name: d.name,
          amt: Math.round(yearly / 12),
          per: 'mo',
          type: d.kind === 'posttax' ? 'posttax' : isHealth ? 's125' : 'pretax',
        })
      }
    }
    // Keep the person's real pay rhythm: one income source carries its cadence
    // over as the pay frequency; several sources default to biweekly.
    const salary = Math.round(annualGross)
    return {
      user_id: member.id,
      name: member.name.split(' ')[0],
      color: member.color,
      pay_type: 'salary' as const,
      salary,
      hourly_rate: Math.round((salary / 2080) * 100) / 100,
      hours_per_week: 40,
      pay_freq: sources.length === 1 ? CADENCE_TO_FREQ[sources[0].cadence] : ('biweekly' as PlanPayFreq),
      next_payday: null,
      k401_pct: annualGross > 0 ? Math.round((k401Yearly / annualGross) * 1000) / 10 : 0,
      // Their actual withheld taxes make a solid starting manual rate.
      manual_tax_pct: annualGross > 0 && taxYearly > 0 ? Math.round((taxYearly / annualGross) * 1000) / 10 : 20,
      items,
    }
  }) as PlanState['people']

  // Shared categories with their 3-month average spend become the planned lines.
  const from = shiftMonth(currentMonth(), -2)
  const categoryRows = app.db
    .prepare(
      `SELECT c.id, c.name, g.sort AS group_sort, c.sort,
              COALESCE((
                SELECT SUM(tl.amount_cents) FROM transaction_lines tl
                JOIN transactions t ON t.id = tl.transaction_id
                WHERE tl.category_id = c.id AND t.kind = 'expense' AND t.date >= ?
              ), 0) AS spent_cents
       FROM categories c LEFT JOIN category_groups g ON g.id = c.group_id
       WHERE c.household_id = ? AND c.scope = 'shared' AND c.archived = 0
       ORDER BY g.sort IS NULL, g.sort, c.sort`,
    )
    .all(`${from}-01`, householdId) as { id: string; name: string; spent_cents: number }[]

  const state: PlanState = {
    v: 4,
    filing: 'mfj',
    tax_mode: 'auto',
    state_rate: 4.95,
    std_ded: STD_DED_MFJ_2026,
    people,
    living_pct: 62,
    personal_pct: 14,
    buckets: defaultBuckets(),
    bucket_locked: [],
    cats: categoryRows.map((row) => ({
      id: planId(),
      name: row.name,
      mode: 'fixed' as const,
      amt: Math.round(row.spent_cents / 3 / 100),
      benefit_a: 50,
      fold_category_id: row.id,
    })),
    personal_mode: 'equal',
  }

  // Size the living slice to roughly cover the pulled categories.
  const math = computePlan(state)
  if (math.pool_mo > 0 && math.cat_sum > 0) {
    const livingPct = Math.min(90, Math.max(10, Math.round((math.cat_sum / math.pool_mo) * 1000) / 10))
    setSplitValue(state, 'living', livingPct)
  }
  return state
}

export async function planRoutes(app: FastifyInstance): Promise<void> {
  app.get('/plan', async (req) => {
    const stored = getSetting<StoredPlan>(app.db, req.user.household_id, PLAN_KEY)
    if (stored) {
      const migrated = migratePlanState(stored.state)
      if (!migrated) return { state: bootstrapPlan(app, req.user.household_id), saved_at: null, saved_by: null, bootstrapped: true }
      const wasOld = (stored.state as { v?: number }).v !== 4
      const linked = reconcilePeople(app, req.user.household_id, migrated)
      if (wasOld || linked) {
        putSetting(app.db, req.user.household_id, PLAN_KEY, { ...stored, state: migrated })
      }
      return { ...stored, state: migrated }
    }
    // First visit: a plan pre-filled from the real household beats a blank form.
    return { state: bootstrapPlan(app, req.user.household_id), saved_at: null, saved_by: null, bootstrapped: true }
  })

  app.put('/plan', async (req) => {
    const { state } = z.object({ state: stateSchema }).parse(req.body)
    const allocTotal = state.living_pct + state.personal_pct + state.buckets.reduce((sum, b) => sum + b.pct, 0)
    if (Math.abs(allocTotal - 100) > 1) badRequest('The pool split must total 100%.')
    const stored: StoredPlan = { state: state as PlanState, saved_at: new Date().toISOString(), saved_by: req.user.name }
    putSetting(app.db, req.user.household_id, PLAN_KEY, stored)
    return { ok: true, saved_at: stored.saved_at }
  })

  /** Re-pull incomes and category averages from the tracked side. */
  app.post('/plan/pull', async (req) => {
    return { state: bootstrapPlan(app, req.user.household_id) }
  })

  /**
   * Push the plan into the real budget: each planned category becomes that
   * month's allocation (creating missing shared categories), so the tracked
   * side starts living against the model.
   */
  app.post('/plan/apply', async (req) => {
    const body = z
      .object({
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        // 'default': becomes the standing budget from `month` onward, filling
        // untouched months as they come up. 'month': a one-off for that month
        // alone — it overrides the default and later defaults leave it be.
        mode: z.enum(['month', 'default']).default('month'),
        state: stateSchema.optional(),
      })
      .parse(req.body)
    const householdId = req.user.household_id
    let state: PlanState
    if (body.state) {
      state = body.state as PlanState
      putSetting(app.db, householdId, PLAN_KEY, {
        state,
        saved_at: new Date().toISOString(),
        saved_by: req.user.name,
      })
    } else {
      const stored = getSetting<StoredPlan>(app.db, householdId, PLAN_KEY)
      const migrated = stored ? migratePlanState(stored.state) : null
      if (!migrated) badRequest('No saved plan to apply yet.')
      state = migrated!
    }

    const math = computePlan(state)
    const shared = app.db
      .prepare(`SELECT id, name FROM categories WHERE household_id = ? AND scope = 'shared' AND archived = 0`)
      .all(householdId) as { id: string; name: string }[]
    const byId = new Map(shared.map((c) => [c.id, c]))
    const byName = new Map(shared.map((c) => [c.name.toLowerCase(), c]))
    let maxSort = (
      app.db.prepare(`SELECT COALESCE(MAX(sort), 0) AS s FROM categories WHERE household_id = ?`).get(householdId) as {
        s: number
      }
    ).s

    let applied = 0
    let created = 0
    let linksChanged = false
    const allocations: Record<string, number> = {}
    state.cats.forEach((cat, index) => {
      const name = cat.name.trim()
      if (!name) return
      let target =
        (cat.fold_category_id && byId.get(cat.fold_category_id)) || byName.get(name.toLowerCase()) || null
      if (!target) {
        const newId = id()
        maxSort += 1
        app.db
          .prepare(
            `INSERT INTO categories (id, household_id, name, emoji, scope, owner_user_id, group_id, rollover, bucket, sort)
             VALUES (?, ?, ?, NULL, 'shared', NULL, NULL, 0, 'need', ?)`,
          )
          .run(newId, householdId, name, maxSort)
        target = { id: newId, name }
        byId.set(newId, target)
        byName.set(name.toLowerCase(), target)
        created += 1
      }
      if (cat.fold_category_id !== target.id) {
        cat.fold_category_id = target.id
        linksChanged = true
      }
      allocations[target.id] = Math.round(planCatMonthly(cat, math.pool_mo) * 100)
      applied += 1
    })

    if (body.mode === 'default') {
      // Standing budget from this month on: untouched months from here forward
      // refresh to these numbers; hand-set months and older months stay put.
      saveBudgetDefault(app.db, householdId, {
        from_month: body.month,
        allocations,
        saved_at: new Date().toISOString(),
        saved_by: req.user.name,
      })
      materializeMonth(app.db, householdId, body.month)
      if (currentMonth() > body.month) materializeMonth(app.db, householdId, currentMonth())
    } else {
      for (const [categoryId, cents] of Object.entries(allocations)) {
        setAllocation(app, categoryId, body.month, cents)
      }
    }

    if (linksChanged && !body.state) {
      const stored = getSetting<StoredPlan>(app.db, householdId, PLAN_KEY)
      if (stored) putSetting(app.db, householdId, PLAN_KEY, { ...stored, state })
    } else if (linksChanged && body.state) {
      putSetting(app.db, householdId, PLAN_KEY, { state, saved_at: new Date().toISOString(), saved_by: req.user.name })
    }
    return { applied, created, month: body.month, mode: body.mode }
  })

  app.get('/plan/scenarios', async (req) => {
    const scenarios = getSetting<StoredScenario[]>(app.db, req.user.household_id, SCENARIOS_KEY) ?? []
    return { scenarios: scenarios.map(({ name, saved_at, saved_by }) => ({ name, saved_at, saved_by })) }
  })

  app.post('/plan/scenarios', async (req) => {
    const { name, state } = z
      .object({ name: z.string().trim().min(1).max(60), state: stateSchema })
      .parse(req.body)
    const scenarios = getSetting<StoredScenario[]>(app.db, req.user.household_id, SCENARIOS_KEY) ?? []
    const next = scenarios.filter((s) => s.name !== name)
    if (next.length >= MAX_SCENARIOS) badRequest(`Keep it under ${MAX_SCENARIOS} scenarios — delete one first.`)
    next.push({ name, state: state as PlanState, saved_at: new Date().toISOString(), saved_by: req.user.name })
    putSetting(app.db, req.user.household_id, SCENARIOS_KEY, next)
    return { ok: true }
  })

  app.get('/plan/scenarios/:name', async (req) => {
    const { name } = req.params as { name: string }
    const scenarios = getSetting<StoredScenario[]>(app.db, req.user.household_id, SCENARIOS_KEY) ?? []
    const scenario = scenarios.find((s) => s.name === name)
    if (!scenario) notFound('Scenario')
    const migrated = migratePlanState(scenario!.state)
    if (!migrated) notFound('Scenario')
    return { ...scenario, state: migrated }
  })

  app.delete('/plan/scenarios/:name', async (req) => {
    const { name } = req.params as { name: string }
    const scenarios = getSetting<StoredScenario[]>(app.db, req.user.household_id, SCENARIOS_KEY) ?? []
    putSetting(
      app.db,
      req.user.household_id,
      SCENARIOS_KEY,
      scenarios.filter((s) => s.name !== name),
    )
    return { ok: true }
  })

  /** The tracked month, shaped for plan-vs-actual: what actually happened. */
  app.get('/plan/actuals', async (req) => {
    const { month } = z
      .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() })
      .parse(req.query)
    const target = month ?? currentMonth()
    const { start, end } = monthRange(target)
    const householdId = req.user.household_id
    materializeMonth(app.db, householdId, target)
    const byCategory = app.db
      .prepare(
        `SELECT c.id AS category_id, c.name, SUM(tl.amount_cents) AS total_cents
         FROM transaction_lines tl
         JOIN transactions t ON t.id = tl.transaction_id
         JOIN categories c ON c.id = tl.category_id
         WHERE t.household_id = ? AND t.kind = 'expense' AND c.scope = 'shared' AND t.date >= ? AND t.date < ?
         GROUP BY c.id`,
      )
      .all(householdId, start, end) as { category_id: string; name: string; total_cents: number }[]
    const personal = app.db
      .prepare(
        `SELECT c.owner_user_id AS user_id, SUM(tl.amount_cents) AS total_cents
         FROM transaction_lines tl
         JOIN transactions t ON t.id = tl.transaction_id
         JOIN categories c ON c.id = tl.category_id
         WHERE t.household_id = ? AND t.kind = 'expense' AND c.scope = 'personal' AND t.date >= ? AND t.date < ?
         GROUP BY c.owner_user_id`,
      )
      .all(householdId, start, end) as { user_id: string; total_cents: number }[]
    const todayStr = today()
    return {
      month: target,
      days_in_month: daysInMonth(target),
      today_day: target === currentMonth() ? Number(todayStr.slice(8, 10)) : daysInMonth(target),
      shared_total_cents: byCategory.reduce((sum, c) => sum + c.total_cents, 0),
      by_category: byCategory,
      personal,
      has_prev: true,
    }
  })
}
