import type { FastifyInstance } from 'fastify'
import type { SummaryAttention, SummaryResponse } from '@fold/shared'
import { computeBudget } from '../lib/budget.js'
import { materializeMonth } from '../lib/defaults.js'
import { findDuplicatePairs } from '../lib/duplicates.js'
import { computeNetWorth } from '../lib/networth.js'
import { getBalances, getTransactions } from '../lib/queries.js'
import { addDays, currentMonth, monthRange, shiftMonth, today } from '../lib/util.js'

/** How many days into a new month last month's review still leads the dashboard. */
const REVIEW_WINDOW_DAYS = 7
const BILLS_HORIZON_DAYS = 7

function computeAttention(app: FastifyInstance, householdId: string, userId: string, month: string): SummaryAttention {
  const now = today()
  materializeMonth(app.db, householdId, month)
  const budget = computeBudget(app.db, householdId, month)
  const over_budget = budget.categories
    .filter((row) => row.available_cents < 0)
    .filter((row) => row.scope === 'shared' || row.owner_user_id === userId)
    .map((row) => ({ id: row.id, name: row.name, over_cents: -row.available_cents, scope: row.scope }))
    .sort((a, b) => b.over_cents - a.over_cents)

  const uncategorized = app.db
    .prepare(
      `SELECT COUNT(DISTINCT t.id) AS c
       FROM transaction_lines tl JOIN transactions t ON t.id = tl.transaction_id
       WHERE t.household_id = ? AND t.kind = 'expense' AND tl.category_id IS NULL`,
    )
    .get(householdId) as { c: number }

  const bills_due = app.db
    .prepare(
      `SELECT id, description, amount_cents, next_date FROM recurring_transactions
       WHERE household_id = ? AND active = 1 AND next_date <= ?
       ORDER BY next_date, description`,
    )
    .all(householdId, addDays(now, BILLS_HORIZON_DAYS)) as SummaryAttention['bills_due']

  const tasks = app.db
    .prepare(
      `SELECT
         SUM(CASE WHEN li.due_date < ? THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN li.due_date = ? THEN 1 ELSE 0 END) AS due_today,
         SUM(CASE WHEN li.due_date < ? AND li.assignee_user_id = ? THEN 1 ELSE 0 END) AS mine_overdue
       FROM list_items li JOIN lists l ON l.id = li.list_id
       WHERE l.household_id = ? AND l.archived = 0 AND li.done = 0 AND li.due_date IS NOT NULL`,
    )
    .get(now, now, now, userId, householdId) as { overdue: number | null; due_today: number | null; mine_overdue: number | null }

  const lastMonth = shiftMonth(month, -1)
  const lastRange = monthRange(lastMonth)
  const lastMonthHadSpending =
    app.db
      .prepare(`SELECT 1 FROM transactions WHERE household_id = ? AND kind = 'expense' AND date >= ? AND date < ? LIMIT 1`)
      .get(householdId, lastRange.start, lastRange.end) != null
  const dayOfMonth = Number(now.slice(8, 10))

  return {
    over_budget,
    uncategorized_count: uncategorized.c,
    bills_due,
    tasks: { overdue: tasks.overdue ?? 0, due_today: tasks.due_today ?? 0, mine_overdue: tasks.mine_overdue ?? 0 },
    duplicate_pairs: findDuplicatePairs(app.db, householdId).length,
    review_ready: dayOfMonth <= REVIEW_WINDOW_DAYS && lastMonthHadSpending ? lastMonth : null,
  }
}

export async function summaryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/summary', async (req): Promise<SummaryResponse> => {
    const householdId = req.user.household_id
    const month = currentMonth()
    const { start, end } = monthRange(month)

    const alloc = app.db
      .prepare(
        `SELECT c.scope, c.owner_user_id, SUM(a.amount_cents) AS total
         FROM allocations a JOIN categories c ON c.id = a.category_id
         WHERE c.household_id = ? AND a.month = ? GROUP BY c.scope, c.owner_user_id`,
      )
      .all(householdId, month) as { scope: string; owner_user_id: string | null; total: number }[]
    const spent = app.db
      .prepare(
        `SELECT c.scope, c.owner_user_id, SUM(tl.amount_cents) AS total
         FROM transaction_lines tl
         JOIN transactions t ON t.id = tl.transaction_id
         JOIN categories c ON c.id = tl.category_id
         WHERE t.household_id = ? AND t.kind = 'expense' AND t.date >= ? AND t.date < ?
         GROUP BY c.scope, c.owner_user_id`,
      )
      .all(householdId, start, end) as { scope: string; owner_user_id: string | null; total: number }[]

    const sharedAlloc = alloc.filter((a) => a.scope === 'shared').reduce((sum, a) => sum + a.total, 0)
    const sharedSpent = spent.filter((s) => s.scope === 'shared').reduce((sum, s) => sum + s.total, 0)
    const myAlloc = alloc
      .filter((a) => a.scope === 'personal' && a.owner_user_id === req.user.id)
      .reduce((sum, a) => sum + a.total, 0)
    const mySpent = spent
      .filter((s) => s.scope === 'personal' && s.owner_user_id === req.user.id)
      .reduce((sum, s) => sum + s.total, 0)

    const trip = app.db
      .prepare(
        `SELECT id, name, emoji, status, location, start_date, end_date, total_budget_cents, notes
         FROM trips
         WHERE household_id = ? AND status IN ('planned', 'active') AND (end_date IS NULL OR end_date >= ?)
         ORDER BY start_date IS NULL, start_date LIMIT 1`,
      )
      .get(householdId, today()) as
      | {
          id: string
          name: string
          emoji: string | null
          status: 'idea' | 'planned' | 'active' | 'done'
          location: string | null
          start_date: string | null
          end_date: string | null
          total_budget_cents: number | null
          notes: string | null
        }
      | undefined

    let next_trip: SummaryResponse['next_trip'] = null
    if (trip) {
      const budget = (
        app.db.prepare('SELECT COALESCE(SUM(budget_cents), 0) AS total FROM trip_categories WHERE trip_id = ?').get(
          trip.id,
        ) as { total: number }
      ).total
      const rollup = app.db
        .prepare(
          `SELECT COALESCE(SUM(planned_cents), 0) AS planned, COALESCE(SUM(COALESCE(actual_cents, 0)), 0) AS spent
           FROM trip_expenses WHERE trip_id = ?`,
        )
        .get(trip.id) as { planned: number; spent: number }
      const days_until = trip.start_date
        ? Math.ceil((Date.parse(`${trip.start_date}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86_400_000)
        : null
      next_trip = {
        ...trip,
        budget_cents: trip.total_budget_cents ?? budget,
        planned_cents: rollup.planned,
        spent_cents: rollup.spent,
        days_until,
      }
    }

    const my_tasks = app.db
      .prepare(
        `SELECT li.id, li.list_id, li.text, li.due_date, li.repeat, l.name AS list_name
         FROM list_items li JOIN lists l ON l.id = li.list_id
         WHERE l.household_id = ? AND li.done = 0 AND li.assignee_user_id = ?
         ORDER BY li.due_date IS NULL, li.due_date LIMIT 8`,
      )
      .all(householdId, req.user.id) as SummaryResponse['my_tasks']

    const netWorth = computeNetWorth(app.db, householdId)

    const memberCount = (
      app.db.prepare('SELECT COUNT(*) AS n FROM users WHERE household_id = ?').get(householdId) as { n: number }
    ).n
    const hasIncome =
      app.db
        .prepare('SELECT 1 FROM income_sources s JOIN users u ON u.id = s.user_id WHERE u.household_id = ? LIMIT 1')
        .get(householdId) != null
    const hasTransaction =
      app.db.prepare('SELECT 1 FROM transactions WHERE household_id = ? LIMIT 1').get(householdId) != null

    return {
      month,
      shared_allocated_cents: sharedAlloc,
      shared_spent_cents: sharedSpent,
      my_personal_allocated_cents: myAlloc,
      my_personal_spent_cents: mySpent,
      balances: getBalances(app.db, householdId),
      next_trip,
      my_tasks,
      recent_transactions: getTransactions(app.db, householdId, { limit: 6 }),
      net_worth:
        netWorth.accounts.length > 0
          ? {
              net_cents: netWorth.net_cents,
              delta_month_cents: netWorth.delta_month_cents,
              account_count: netWorth.accounts.length,
            }
          : null,
      setup: {
        has_income: hasIncome,
        has_budget: sharedAlloc + alloc.filter((a) => a.scope === 'personal').reduce((sum, a) => sum + a.total, 0) > 0,
        has_transaction: hasTransaction,
        partner_linked: memberCount > 1,
      },
      attention: computeAttention(app, householdId, req.user.id, month),
    }
  })
}
