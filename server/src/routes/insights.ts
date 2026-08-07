import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { InsightsResponse } from '@fold/shared'
import { effectiveIncomes } from '../lib/budget.js'
import { addDays, currentMonth, daysInMonth, monthList, monthRange, shiftMonth, today } from '../lib/util.js'

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

export async function insightsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/insights', async (req): Promise<InsightsResponse> => {
    const { months } = z.object({ months: z.coerce.number().int().min(2).max(12).default(6) }).parse(req.query)
    const householdId = req.user.household_id
    const to = currentMonth()
    const from = shiftMonth(to, -(months - 1))
    const windowStart = `${from}-01`
    const windowEnd = monthRange(to).end
    const todayStr = today()

    // --- daily totals (heatmap, burn, habits) --------------------------------
    const daily = app.db
      .prepare(
        `SELECT date, SUM(amount_cents) AS total_cents, COUNT(*) AS count
         FROM transactions
         WHERE household_id = ? AND kind = 'expense' AND date >= ? AND date < ?
         GROUP BY date ORDER BY date`,
      )
      .all(householdId, windowStart, windowEnd) as { date: string; total_cents: number; count: number }[]
    const dailyByDate = new Map(daily.map((d) => [d.date, d]))

    // --- weekday averages over the elapsed window ----------------------------
    const weekdayTotals = new Array(7).fill(0)
    const weekdayOccurrences = new Array(7).fill(0)
    for (let cursor = windowStart; cursor <= todayStr; cursor = addDays(cursor, 1)) {
      weekdayOccurrences[weekdayOf(cursor)] += 1
    }
    let windowTotal = 0
    let weekendTotal = 0
    for (const day of daily) {
      const dow = weekdayOf(day.date)
      weekdayTotals[dow] += day.total_cents
      windowTotal += day.total_cents
      if (dow === 0 || dow === 6) weekendTotal += day.total_cents
    }
    const weekday_avg = weekdayTotals.map((total, dow) =>
      weekdayOccurrences[dow] > 0 ? Math.round(total / weekdayOccurrences[dow]) : 0,
    )

    // --- habits --------------------------------------------------------------
    const last30Start = addDays(todayStr, -29)
    let noSpend30 = 0
    let longestStreak = 0
    let streak = 0
    for (let cursor = last30Start; cursor <= todayStr; cursor = addDays(cursor, 1)) {
      const spent = (dailyByDate.get(cursor)?.total_cents ?? 0) > 0
      if (!spent) {
        noSpend30 += 1
        streak += 1
        longestStreak = Math.max(longestStreak, streak)
      } else {
        streak = 0
      }
    }
    const purchases = app.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total,
                COALESCE(SUM(CASE WHEN recurring_id IS NOT NULL THEN amount_cents ELSE 0 END), 0) AS autopilot
         FROM transactions
         WHERE household_id = ? AND kind = 'expense' AND amount_cents > 0 AND date >= ? AND date < ?`,
      )
      .get(householdId, windowStart, windowEnd) as { n: number; total: number; autopilot: number }
    const elapsedDays = Math.max(
      1,
      Math.round((Date.parse(`${todayStr}T00:00:00Z`) - Date.parse(`${windowStart}T00:00:00Z`)) / 86_400_000) + 1,
    )
    const busiest = weekday_avg.indexOf(Math.max(...weekday_avg))

    // --- cumulative burn: this month vs last ---------------------------------
    const cumulate = (month: string, throughDay: number): number[] => {
      const out: number[] = []
      let running = 0
      for (let day = 1; day <= throughDay; day++) {
        const date = `${month}-${String(day).padStart(2, '0')}`
        running += dailyByDate.get(date)?.total_cents ?? 0
        out.push(running)
      }
      return out
    }
    const todayDay = Number(todayStr.slice(8, 10))
    const lastMonth = shiftMonth(to, -1)
    const budgetRow = app.db
      .prepare(
        `SELECT COALESCE(SUM(a.amount_cents), 0) AS total
         FROM allocations a JOIN categories c ON c.id = a.category_id
         WHERE c.household_id = ? AND a.month = ?`,
      )
      .get(householdId, to) as { total: number }

    // --- this month's money flow --------------------------------------------
    const { start: monthStart, end: monthEnd } = monthRange(to)
    const incomes = effectiveIncomes(app.db, householdId, to)
    const shareRows = app.db
      .prepare(
        `SELECT ts.user_id, SUM(ts.share_cents) AS total
         FROM transaction_splits ts JOIN transactions t ON t.id = ts.transaction_id
         WHERE t.household_id = ? AND t.kind = 'expense' AND t.date >= ? AND t.date < ?
         GROUP BY ts.user_id`,
      )
      .all(householdId, monthStart, monthEnd) as { user_id: string; total: number }[]
    const personalRows = app.db
      .prepare(
        `SELECT c.owner_user_id AS user_id, SUM(tl.amount_cents) AS total
         FROM transaction_lines tl
         JOIN transactions t ON t.id = tl.transaction_id
         JOIN categories c ON c.id = tl.category_id
         WHERE t.household_id = ? AND t.kind = 'expense' AND c.scope = 'personal' AND t.date >= ? AND t.date < ?
         GROUP BY c.owner_user_id`,
      )
      .all(householdId, monthStart, monthEnd) as { user_id: string; total: number }[]
    const sharedTotalRow = app.db
      .prepare(
        `SELECT COALESCE(SUM(tl.amount_cents), 0) AS total
         FROM transaction_lines tl
         JOIN transactions t ON t.id = tl.transaction_id
         LEFT JOIN categories c ON c.id = tl.category_id
         WHERE t.household_id = ? AND t.kind = 'expense' AND (c.scope = 'shared' OR c.id IS NULL) AND t.date >= ? AND t.date < ?`,
      )
      .get(householdId, monthStart, monthEnd) as { total: number }
    const flowMembers = incomes.map((member) => {
      const share = shareRows.find((s) => s.user_id === member.id)?.total ?? 0
      const personal = personalRows.find((p) => p.user_id === member.id)?.total ?? 0
      const shared = Math.max(0, share - personal)
      return {
        user_id: member.id,
        name: member.name,
        color: member.color,
        income_cents: member.income,
        shared_cents: shared,
        personal_cents: Math.max(0, personal),
        kept_cents: member.income - share,
      }
    })

    // --- treemap: window totals per category, tagged by group ----------------
    const treemapRows = app.db
      .prepare(
        `SELECT c.id AS category_id, c.name, c.emoji, c.scope, c.owner_user_id,
                g.name AS group_name, g.sort AS group_sort, SUM(tl.amount_cents) AS total_cents
         FROM transaction_lines tl
         JOIN transactions t ON t.id = tl.transaction_id
         LEFT JOIN categories c ON c.id = tl.category_id
         LEFT JOIN category_groups g ON g.id = c.group_id
         WHERE t.household_id = ? AND t.kind = 'expense' AND t.date >= ? AND t.date < ?
         GROUP BY c.id
         HAVING total_cents > 0
         ORDER BY group_sort IS NULL, group_sort, total_cents DESC`,
      )
      .all(householdId, windowStart, windowEnd) as {
      category_id: string | null
      name: string | null
      emoji: string | null
      scope: string | null
      owner_user_id: string | null
      group_name: string | null
      group_sort: number | null
      total_cents: number
    }[]
    const firstName = new Map(incomes.map((m) => [m.id, m.name.split(' ')[0]]))
    const treemap = treemapRows.map((row) => ({
      category_id: row.category_id ?? 'uncategorized',
      name: row.name ?? 'Uncategorized',
      emoji: row.emoji,
      group:
        row.group_name ??
        (row.scope === 'personal' && row.owner_user_id
          ? `${firstName.get(row.owner_user_id) ?? '?'}’s personal`
          : row.category_id
            ? 'Other shared'
            : 'Uncategorized'),
      total_cents: row.total_cents,
    }))
    // Deterministic group order (budget sort, then per-member personal, then the
    // catch-alls) so chart colors follow the group across every window — a group
    // must never change hue because the reader picked a different time range.
    const groupRank = new Map<string, number>()
    for (const row of treemapRows) {
      if (row.group_name != null && row.group_sort != null && !groupRank.has(row.group_name)) {
        groupRank.set(row.group_name, row.group_sort)
      }
    }
    incomes.forEach((member, index) => groupRank.set(`${firstName.get(member.id) ?? '?'}’s personal`, 900 + index))
    groupRank.set('Other shared', 950)
    groupRank.set('Uncategorized', 999)
    treemap.sort(
      (a, b) => (groupRank.get(a.group) ?? 998) - (groupRank.get(b.group) ?? 998) || b.total_cents - a.total_cents,
    )

    // --- top stores ----------------------------------------------------------
    const merchants = app.db
      .prepare(
        `SELECT m.id, m.name, m.domain, SUM(t.amount_cents) AS total_cents, COUNT(*) AS visits
         FROM transactions t JOIN merchants m ON m.id = t.merchant_id
         WHERE t.household_id = ? AND t.kind = 'expense' AND t.amount_cents > 0 AND t.date >= ? AND t.date < ?
         GROUP BY m.id ORDER BY total_cents DESC LIMIT 8`,
      )
      .all(householdId, windowStart, windowEnd) as InsightsResponse['merchants']

    // --- per-category sparklines --------------------------------------------
    const monthsList = monthList(from, to)
    const sparkRows = app.db
      .prepare(
        `SELECT tl.category_id, substr(t.date, 1, 7) AS month, SUM(tl.amount_cents) AS total
         FROM transaction_lines tl
         JOIN transactions t ON t.id = tl.transaction_id
         WHERE t.household_id = ? AND t.kind = 'expense' AND tl.category_id IS NOT NULL AND t.date >= ? AND t.date < ?
         GROUP BY tl.category_id, month`,
      )
      .all(householdId, windowStart, windowEnd) as { category_id: string; month: string; total: number }[]
    const categoryMeta = app.db
      .prepare(`SELECT id, name, emoji, scope FROM categories WHERE household_id = ? AND archived = 0`)
      .all(householdId) as { id: string; name: string; emoji: string | null; scope: 'shared' | 'personal' }[]
    const sparklines = categoryMeta
      .map((category) => {
        const series = monthsList.map(
          (month) => sparkRows.find((r) => r.category_id === category.id && r.month === month)?.total ?? 0,
        )
        return {
          category_id: category.id,
          name: category.name,
          emoji: category.emoji,
          scope: category.scope,
          months: series,
          total: series.reduce((sum, v) => sum + v, 0),
        }
      })
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 12)
      .map(({ total: _total, ...rest }) => rest)

    return {
      months,
      from,
      to,
      daily,
      habits: {
        no_spend_days_30: noSpend30,
        longest_no_spend_streak_30: longestStreak,
        busiest_weekday: busiest,
        weekend_share_pct: windowTotal > 0 ? Math.round((weekendTotal / windowTotal) * 100) : 0,
        autopilot_share_pct: purchases.total > 0 ? Math.round((purchases.autopilot / purchases.total) * 100) : 0,
        avg_purchase_cents: purchases.n > 0 ? Math.round(purchases.total / purchases.n) : 0,
        tx_per_week: Math.round((purchases.n / Math.max(1, elapsedDays / 7)) * 10) / 10,
      },
      burn: {
        days_in_month: daysInMonth(to),
        today_day: todayDay,
        this_month: cumulate(to, todayDay),
        last_month: cumulate(lastMonth, daysInMonth(lastMonth)),
        budget_cents: budgetRow.total,
      },
      weekday_avg,
      flow: { month: to, members: flowMembers, shared_total_cents: sharedTotalRow.total },
      treemap,
      merchants,
      sparklines,
    }
  })
}
