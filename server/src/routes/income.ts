import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Cadence, IncomeSource, IncomeSummaryResponse, PayDeduction, SplitBasis, SplitRule } from '@fold/shared'
import { monthlyCents, splitByWeights } from '@fold/shared'
import { getMembers } from '../lib/queries.js'
import { badRequest, currentMonth, id, notFound } from '../lib/util.js'

const cadence = z.enum(['monthly', 'semimonthly', 'biweekly', 'weekly', 'annual'])

const deductionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  amount_cents: z.number().int().min(0),
  kind: z.enum(['tax', 'pretax', 'posttax']),
})

const createBody = z.object({
  user_id: z.string(),
  name: z.string().trim().min(1).max(80),
  amount_cents: z.number().int().min(0),
  gross_cents: z.number().int().min(0).nullish(),
  deductions: z.array(deductionSchema).max(20).nullish(),
  cadence,
  notes: z.string().max(500).nullish(),
})

const patchBody = createBody.partial().omit({ user_id: true }).extend({
  active: z.union([z.literal(0), z.literal(1)]).optional(),
})

/**
 * Resolve the stored (net, gross, deductions) triple. When paycheck details
 * are given, net is always derived as gross − deductions so the numbers can
 * never disagree; without them the plain amount is the net.
 */
function resolveAmounts(input: {
  amount_cents: number
  gross_cents?: number | null
  deductions?: PayDeduction[] | null
}): { amount: number; gross: number | null; deductions: string | null } {
  if (input.gross_cents == null) {
    return { amount: input.amount_cents, gross: null, deductions: null }
  }
  const deductions = input.deductions ?? []
  const total = deductions.reduce((sum, d) => sum + d.amount_cents, 0)
  if (total > input.gross_cents) badRequest('Deductions add up to more than the gross paycheck.')
  return {
    amount: input.gross_cents - total,
    gross: input.gross_cents,
    deductions: JSON.stringify(deductions),
  }
}

function parseSource(row: Record<string, unknown>): IncomeSource {
  return {
    ...(row as unknown as IncomeSource),
    deductions: row.deductions ? (JSON.parse(row.deductions as string) as PayDeduction[]) : null,
  }
}

export async function incomeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/income', async (req): Promise<{ sources: IncomeSource[] }> => {
    const rows = app.db
      .prepare(
        `SELECT i.id, i.user_id, i.name, i.amount_cents, i.gross_cents, i.deductions, i.cadence, i.active, i.notes
         FROM income_sources i JOIN users u ON u.id = i.user_id
         WHERE u.household_id = ? ORDER BY i.name`,
      )
      .all(req.user.household_id) as Record<string, unknown>[]
    return { sources: rows.map(parseSource) }
  })

  app.post('/income', async (req) => {
    const body = createBody.parse(req.body)
    const owner = app.db
      .prepare('SELECT id FROM users WHERE id = ? AND household_id = ?')
      .get(body.user_id, req.user.household_id)
    if (!owner) badRequest('That person is not in your household.')
    const { amount, gross, deductions } = resolveAmounts(body)
    const sourceId = id()
    app.db
      .prepare(
        'INSERT INTO income_sources (id, user_id, name, amount_cents, gross_cents, deductions, cadence, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(sourceId, body.user_id, body.name, amount, gross, deductions, body.cadence, body.notes ?? null)
    return { id: sourceId }
  })

  app.patch('/income/:id', async (req) => {
    const body = patchBody.parse(req.body)
    const { id: sourceId } = req.params as { id: string }
    const row = app.db
      .prepare(
        `SELECT i.id, i.amount_cents, i.gross_cents, i.deductions FROM income_sources i JOIN users u ON u.id = i.user_id
         WHERE i.id = ? AND u.household_id = ?`,
      )
      .get(sourceId, req.user.household_id) as
      | { id: string; amount_cents: number; gross_cents: number | null; deductions: string | null }
      | undefined
    if (!row) notFound('Income source')

    const fields: Record<string, string | number | null> = {}
    if (body.name !== undefined) fields.name = body.name
    if (body.cadence !== undefined) fields.cadence = body.cadence
    if (body.notes !== undefined) fields.notes = body.notes ?? null
    if (body.active !== undefined) fields.active = body.active
    if (body.amount_cents !== undefined || body.gross_cents !== undefined || body.deductions !== undefined) {
      const merged = resolveAmounts({
        amount_cents: body.amount_cents ?? row!.amount_cents,
        gross_cents: body.gross_cents !== undefined ? body.gross_cents : row!.gross_cents,
        deductions:
          body.deductions !== undefined
            ? body.deductions
            : row!.deductions
              ? (JSON.parse(row!.deductions) as PayDeduction[])
              : null,
      })
      fields.amount_cents = merged.amount
      fields.gross_cents = merged.gross
      fields.deductions = merged.deductions
    }
    const keys = Object.keys(fields)
    if (keys.length > 0) {
      const assignments = keys.map((k) => `${k} = ?`).join(', ')
      app.db.prepare(`UPDATE income_sources SET ${assignments} WHERE id = ?`).run(...keys.map((k) => fields[k]), sourceId)
    }
    return { ok: true }
  })

  app.delete('/income/:id', async (req) => {
    const { id: sourceId } = req.params as { id: string }
    const result = app.db
      .prepare(
        `DELETE FROM income_sources WHERE id = ? AND user_id IN (SELECT id FROM users WHERE household_id = ?)`,
      )
      .run(sourceId, req.user.household_id)
    if (result.changes === 0) notFound('Income source')
    return { ok: true }
  })

  /**
   * The gross → deductions → net picture per person, plus what each split
   * rule (50/50, by net, by gross) would mean for this month's shared budget.
   */
  app.get('/income/summary', async (req): Promise<IncomeSummaryResponse> => {
    const query = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }).parse(req.query)
    const month = query.month ?? currentMonth()
    const householdId = req.user.household_id
    const household = app.db
      .prepare('SELECT split_rule, split_basis FROM households WHERE id = ?')
      .get(householdId) as unknown as { split_rule: SplitRule; split_basis: SplitBasis }
    const members = getMembers(app.db, householdId)

    const sources = app.db
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

    const summaryMembers = members.map((member) => {
      const mine = sources.filter((s) => s.user_id === member.id)
      const totals = { tax: 0, pretax: 0, posttax: 0 }
      let hasBreakdown = false
      for (const source of mine) {
        if (source.gross_cents == null) continue
        hasBreakdown = true
        const deductions = source.deductions ? (JSON.parse(source.deductions) as PayDeduction[]) : []
        for (const deduction of deductions) {
          totals[deduction.kind] += monthlyCents(deduction.amount_cents, source.cadence)
        }
      }
      return {
        user_id: member.id,
        name: member.name,
        color: member.color,
        gross_cents: member.monthly_gross_cents,
        tax_cents: totals.tax,
        pretax_cents: totals.pretax,
        posttax_cents: totals.posttax,
        net_cents: member.monthly_income_cents,
        has_breakdown: hasBreakdown,
      }
    })

    const shared_allocated_cents = (
      app.db
        .prepare(
          `SELECT COALESCE(SUM(a.amount_cents), 0) AS total FROM allocations a
           JOIN categories c ON c.id = a.category_id
           WHERE c.household_id = ? AND a.month = ? AND c.scope = 'shared' AND c.archived = 0`,
        )
        .get(householdId, month) as { total: number }
    ).total

    function option(key: 'equal' | 'net' | 'gross', label: string, weightOf: (m: (typeof summaryMembers)[number]) => number) {
      const weights = summaryMembers.map((m) => ({ user_id: m.user_id, weight: weightOf(m) }))
      const total = weights.reduce((sum, w) => sum + w.weight, 0)
      const shares = splitByWeights(shared_allocated_cents, weights)
      return {
        key,
        label,
        shares: summaryMembers.map((m) => ({
          user_id: m.user_id,
          pct:
            total > 0
              ? Math.round((weights.find((w) => w.user_id === m.user_id)!.weight / total) * 1000) / 10
              : Math.round(1000 / summaryMembers.length) / 10,
          contribution_cents: shares.find((s) => s.user_id === m.user_id)?.share_cents ?? 0,
        })),
      }
    }

    const options = [
      option('equal', '50 / 50', () => 1),
      option('net', 'By take-home (net)', (m) => m.net_cents),
      option('gross', 'By gross pay', (m) => m.gross_cents),
    ]

    const active_key =
      household.split_rule === 'equal'
        ? ('equal' as const)
        : household.split_rule === 'custom'
          ? ('custom' as const)
          : household.split_basis === 'gross'
            ? ('gross' as const)
            : ('net' as const)

    return { month, shared_allocated_cents, members: summaryMembers, options, active_key }
  })
}
