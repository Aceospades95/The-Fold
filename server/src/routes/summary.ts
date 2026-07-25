import type { FastifyInstance } from 'fastify'
import type { SummaryResponse } from '@fold/shared'
import { getBalances, getTransactions } from '../lib/queries.js'
import { currentMonth, monthRange, today } from '../lib/util.js'

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
        `SELECT c.scope, c.owner_user_id, SUM(t.amount_cents) AS total
         FROM transactions t JOIN categories c ON c.id = t.category_id
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
        `SELECT li.id, li.list_id, li.text, li.due_date, l.name AS list_name
         FROM list_items li JOIN lists l ON l.id = li.list_id
         WHERE l.household_id = ? AND li.done = 0 AND li.assignee_user_id = ?
         ORDER BY li.due_date IS NULL, li.due_date LIMIT 8`,
      )
      .all(householdId, req.user.id) as { id: string; list_id: string; text: string; due_date: string | null; list_name: string }[]

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
    }
  })
}
