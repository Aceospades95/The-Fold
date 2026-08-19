import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ReviewResponse } from '@fold/shared'
import { computeBudget } from '../lib/budget.js'
import { computeNetWorth } from '../lib/networth.js'
import { getBalances } from '../lib/queries.js'
import { currentMonth, monthRange, shiftMonth } from '../lib/util.js'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/review/:month', async (req): Promise<ReviewResponse> => {
    const { month } = z.object({ month: z.string().regex(MONTH) }).parse(req.params)
    const householdId = req.user.household_id
    const budget = computeBudget(app.db, householdId, month)
    const { start, end } = monthRange(month)

    const shares = app.db
      .prepare(
        `SELECT ts.user_id, SUM(ts.share_cents) AS total
         FROM transaction_splits ts JOIN transactions t ON t.id = ts.transaction_id
         WHERE t.household_id = ? AND t.kind = 'expense' AND t.date >= ? AND t.date < ?
         GROUP BY ts.user_id`,
      )
      .all(householdId, start, end) as { user_id: string; total: number }[]

    const counts = app.db
      .prepare(
        `SELECT COUNT(*) AS n FROM transactions WHERE household_id = ? AND kind = 'expense' AND date >= ? AND date < ?`,
      )
      .get(householdId, start, end) as { n: number }

    const biggest = app.db
      .prepare(
        `SELECT t.id, t.date, t.description, t.amount_cents, t.payer_user_id, m.name AS merchant_name
         FROM transactions t LEFT JOIN merchants m ON m.id = t.merchant_id
         WHERE t.household_id = ? AND t.kind = 'expense' AND t.amount_cents > 0 AND t.date >= ? AND t.date < ?
         ORDER BY t.amount_cents DESC, t.date LIMIT 5`,
      )
      .all(householdId, start, end) as ReviewResponse['biggest_purchases']

    // Is there anything to page back to / forward to?
    const hasPrev =
      app.db
        .prepare(
          `SELECT 1 FROM transactions WHERE household_id = ? AND date < ?
           UNION SELECT 1 FROM allocations a JOIN categories c ON c.id = a.category_id
           WHERE c.household_id = ? AND a.month < ? LIMIT 1`,
        )
        .get(householdId, start, householdId, month) != null
    const hasNext = month < currentMonth()

    // Month-over-month deltas, only when last month saw any activity.
    const prev = shiftMonth(month, -1)
    const prevBudget = hasPrev ? computeBudget(app.db, householdId, prev) : null
    const vs_prev =
      prevBudget && (prevBudget.total_spent_cents !== 0 || prevBudget.has_allocations)
        ? {
            spent_delta_cents: budget.total_spent_cents - prevBudget.total_spent_cents,
            income_delta_cents: budget.combined_income_cents - prevBudget.combined_income_cents,
          }
        : null

    const spent = budget.total_spent_cents + budget.uncategorized.amount_cents
    const income = budget.combined_income_cents
    const kept = income - spent

    const active = budget.categories.filter((c) => c.archived !== 1)
    // Both people usually have a "Fun money" — say whose is whose.
    const firstName = new Map(budget.members.map((m) => [m.id, m.name.split(' ')[0]]))
    const label = (c: (typeof active)[number]): string =>
      c.scope === 'personal' && c.owner_user_id ? `${c.name} · ${firstName.get(c.owner_user_id) ?? '?'}` : c.name
    const overspent = active
      .filter((c) => c.available_cents < 0)
      .sort((a, b) => a.available_cents - b.available_cents)
      .slice(0, 5)
      .map((c) => ({ category_id: c.id, name: label(c), emoji: c.emoji, amount_cents: -c.available_cents }))
    const wins = active
      .filter((c) => c.rollover !== 1 && c.allocated_cents > 0 && c.spent_cents < c.allocated_cents && c.spent_cents > 0)
      .sort((a, b) => b.allocated_cents - b.spent_cents - (a.allocated_cents - a.spent_cents))
      .slice(0, 5)
      .map((c) => ({ category_id: c.id, name: label(c), emoji: c.emoji, amount_cents: c.allocated_cents - c.spent_cents }))
    const rolled_forward = active
      .filter((c) => c.rollover === 1 && c.available_cents > 0)
      .sort((a, b) => b.available_cents - a.available_cents)
      .slice(0, 5)
      .map((c) => ({ category_id: c.id, name: label(c), emoji: c.emoji, amount_cents: c.available_cents }))
    const top_categories = [...active]
      .filter((c) => c.spent_cents > 0)
      .sort((a, b) => b.spent_cents - a.spent_cents)
      .slice(0, 6)
      .map((c) => ({
        category_id: c.id,
        name: label(c),
        emoji: c.emoji,
        spent_cents: c.spent_cents,
        allocated_cents: c.allocated_cents + c.carryover_cents,
      }))

    return {
      month,
      has_prev: hasPrev,
      has_next: hasNext,
      income_cents: income,
      spent_cents: spent,
      kept_cents: kept,
      savings_rate: income > 0 ? Math.round((kept / income) * 100) : null,
      shared_spent_cents: budget.shared_spent_cents,
      transactions_count: counts.n,
      uncategorized_count: budget.uncategorized.count,
      vs_prev,
      members: budget.members.map((m) => ({
        user_id: m.id,
        name: m.name,
        color: m.color,
        share_cents: shares.find((s) => s.user_id === m.id)?.total ?? 0,
        personal_spent_cents: m.personal_spent_cents,
      })),
      overspent,
      wins,
      rolled_forward,
      top_categories,
      biggest_purchases: biggest,
      balance: getBalances(app.db, householdId).suggestion,
      net_worth_delta_cents: month === currentMonth() ? computeNetWorth(app.db, householdId).delta_month_cents : null,
    }
  })
}
