import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PlanState } from '@fold/shared'
import { PLAN_ALLOC_KEYS, STD_DED_MFJ_2026, computePlan, monthlyCents, planId, rebalanceAlloc } from '@fold/shared'
import type { Cadence, PayDeduction } from '@fold/shared'
import { getMembers } from '../lib/queries.js'
import { getSetting, putSetting } from '../lib/webhooks.js'
import { badRequest, currentMonth, daysInMonth, monthRange, notFound, shiftMonth, today } from '../lib/util.js'

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
  gross: z.number().min(0).max(100_000_000),
  k401_pct: z.number().min(0).max(100),
  items: z.array(deductionSchema).max(30),
})

const stateSchema = z.object({
  v: z.literal(1),
  filing: z.enum(['mfj', 'single']),
  state_rate: z.number().min(0).max(20),
  std_ded: z.number().min(0).max(1_000_000),
  people: z.tuple([personSchema, personSchema]),
  alloc: z.object({
    living: z.number().min(0).max(100),
    savings: z.number().min(0).max(100),
    invest: z.number().min(0).max(100),
    trip: z.number().min(0).max(100),
    personal: z.number().min(0).max(100),
  }),
  cats: z
    .array(
      z.object({
        id: z.string().max(40),
        name: z.string().max(80),
        amt: z.number().min(0).max(10_000_000),
        benefit_a: z.number().min(0).max(100),
        fold_category_id: z.string().max(60).nullish(),
      }),
    )
    .max(80),
  personal_mode: z.enum(['equal', 'prop']),
  trip_goal: z.number().min(0).max(100_000_000),
})

interface StoredPlan {
  state: PlanState
  saved_at: string
  saved_by: string
}

interface StoredScenario extends StoredPlan {
  name: string
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
      return { user_id: null, name: index === 0 ? 'You' : 'Partner', color: '#10b981', gross: 0, k401_pct: 0, items: [] }
    }
    const sources = incomeRows.filter((r) => r.user_id === member.id)
    let gross = 0
    let k401Yearly = 0
    const items: PlanState['people'][0]['items'] = []
    for (const source of sources) {
      const grossYearly = monthlyCents(source.gross_cents ?? source.amount_cents, source.cadence) * 12
      gross += grossYearly / 100
      const deductions = source.deductions ? (JSON.parse(source.deductions) as PayDeduction[]) : []
      for (const d of deductions) {
        const yearly = monthlyCents(d.amount_cents, source.cadence) * 12 / 100
        if (d.kind === 'tax') continue // the plan computes taxes itself
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
    return {
      user_id: member.id,
      name: member.name.split(' ')[0],
      color: member.color,
      gross: Math.round(gross),
      k401_pct: gross > 0 ? Math.round((k401Yearly / gross) * 1000) / 10 : 0,
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
    v: 1,
    filing: 'mfj',
    state_rate: 4.95,
    std_ded: STD_DED_MFJ_2026,
    people,
    alloc: { living: 62, savings: 12, invest: 8, trip: 4, personal: 14 },
    cats: categoryRows.map((row) => ({
      id: planId(),
      name: row.name,
      amt: Math.round(row.spent_cents / 3 / 100),
      benefit_a: 50,
      fold_category_id: row.id,
    })),
    personal_mode: 'equal',
    trip_goal: 6000,
  }

  // Size the living bucket to roughly cover the pulled categories.
  const math = computePlan(state)
  if (math.pool_mo > 0 && math.cat_sum > 0) {
    const livingPct = Math.min(90, Math.max(10, Math.round((math.cat_sum / math.pool_mo) * 1000) / 10))
    state.alloc = rebalanceAlloc(state.alloc, 'living', livingPct)
  }
  return state
}

export async function planRoutes(app: FastifyInstance): Promise<void> {
  app.get('/plan', async (req) => {
    const stored = getSetting<StoredPlan>(app.db, req.user.household_id, PLAN_KEY)
    if (stored) return stored
    // First visit: a plan pre-filled from the real household beats a blank form.
    return { state: bootstrapPlan(app, req.user.household_id), saved_at: null, saved_by: null, bootstrapped: true }
  })

  app.put('/plan', async (req) => {
    const { state } = z.object({ state: stateSchema }).parse(req.body)
    const allocTotal = PLAN_ALLOC_KEYS.reduce((sum, k) => sum + state.alloc[k], 0)
    if (Math.abs(allocTotal - 100) > 1) badRequest('Bucket percentages must total 100.')
    const stored: StoredPlan = { state: state as PlanState, saved_at: new Date().toISOString(), saved_by: req.user.name }
    putSetting(app.db, req.user.household_id, PLAN_KEY, stored)
    return { ok: true, saved_at: stored.saved_at }
  })

  /** Re-pull incomes and category averages from the tracked side. */
  app.post('/plan/pull', async (req) => {
    return { state: bootstrapPlan(app, req.user.household_id) }
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
    return scenario
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
