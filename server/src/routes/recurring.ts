import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { RecurringTx } from '@fold/shared'
import { firstOccurrence, materializeRecurring } from '../lib/recurring.js'
import { badRequest, id, notFound, now, today } from '../lib/util.js'

const splitSchema = z.object({ user_id: z.string(), share_cents: z.number().int().min(0) })

const recurringBody = z.object({
  description: z.string().trim().min(1).max(200),
  amount_cents: z.number().int().positive(),
  category_id: z.string().nullish(),
  payer_user_id: z.string(),
  splits: z.array(splitSchema).min(1),
  cadence: z.enum(['monthly', 'yearly']).default('monthly'),
  day_of_month: z.number().int().min(1).max(28),
  notes: z.string().max(500).nullish(),
})

function validate(app: FastifyInstance, householdId: string, body: z.infer<typeof recurringBody>): void {
  const memberIds = (
    app.db.prepare('SELECT id FROM users WHERE household_id = ?').all(householdId) as { id: string }[]
  ).map((m) => m.id)
  if (!memberIds.includes(body.payer_user_id)) badRequest('Payer is not in your household.')
  for (const split of body.splits) {
    if (!memberIds.includes(split.user_id)) badRequest('Split member is not in your household.')
  }
  const total = body.splits.reduce((sum, s) => sum + s.share_cents, 0)
  if (total !== body.amount_cents) badRequest('Split shares must add up to the amount.')
  if (body.category_id) {
    const category = app.db
      .prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?')
      .get(body.category_id, householdId)
    if (!category) badRequest('Unknown category.')
  }
}

export async function recurringRoutes(app: FastifyInstance): Promise<void> {
  app.get('/recurring', async (req): Promise<{ recurring: RecurringTx[] }> => {
    const rows = app.db
      .prepare(
        `SELECT id, description, amount_cents, category_id, payer_user_id, splits, cadence, day_of_month, next_date, active, notes
         FROM recurring_transactions WHERE household_id = ? ORDER BY day_of_month, description`,
      )
      .all(req.user.household_id) as unknown as (Omit<RecurringTx, 'splits'> & { splits: string })[]
    return { recurring: rows.map((r) => ({ ...r, splits: JSON.parse(r.splits) })) }
  })

  app.post('/recurring', async (req) => {
    const body = recurringBody.parse(req.body)
    validate(app, req.user.household_id, body)
    const recurringId = id()
    app.db
      .prepare(
        `INSERT INTO recurring_transactions (id, household_id, description, amount_cents, category_id, payer_user_id, splits, cadence, day_of_month, next_date, active, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        recurringId,
        req.user.household_id,
        body.description,
        body.amount_cents,
        body.category_id ?? null,
        body.payer_user_id,
        JSON.stringify(body.splits),
        body.cadence,
        body.day_of_month,
        firstOccurrence(today(), body.day_of_month),
        body.notes ?? null,
        now(),
      )
    const created = materializeRecurring(app.db)
    return { id: recurringId, posted_now: created }
  })

  app.patch('/recurring/:id', async (req) => {
    const { id: recurringId } = req.params as { id: string }
    const existing = app.db
      .prepare('SELECT id, day_of_month FROM recurring_transactions WHERE id = ? AND household_id = ?')
      .get(recurringId, req.user.household_id) as { id: string; day_of_month: number } | undefined
    if (!existing) notFound('Recurring transaction')
    const body = recurringBody.partial().extend({ active: z.union([z.literal(0), z.literal(1)]).optional() }).parse(req.body)
    if (body.amount_cents !== undefined || body.splits !== undefined || body.payer_user_id !== undefined || body.category_id !== undefined) {
      const merged = recurringBody.parse({ ...currentRow(app, recurringId), ...(req.body as Record<string, unknown>) })
      validate(app, req.user.household_id, merged)
    }
    const fields: Record<string, string | number | null> = {}
    if (body.description !== undefined) fields.description = body.description
    if (body.amount_cents !== undefined) fields.amount_cents = body.amount_cents
    if (body.category_id !== undefined) fields.category_id = body.category_id ?? null
    if (body.payer_user_id !== undefined) fields.payer_user_id = body.payer_user_id
    if (body.splits !== undefined) fields.splits = JSON.stringify(body.splits)
    if (body.cadence !== undefined) fields.cadence = body.cadence
    if (body.notes !== undefined) fields.notes = body.notes ?? null
    if (body.active !== undefined) fields.active = body.active
    if (body.day_of_month !== undefined) {
      fields.day_of_month = body.day_of_month
      fields.next_date = firstOccurrence(today(), body.day_of_month)
    }
    const keys = Object.keys(fields)
    if (keys.length > 0) {
      const assignments = keys.map((k) => `${k} = ?`).join(', ')
      app.db
        .prepare(`UPDATE recurring_transactions SET ${assignments} WHERE id = ?`)
        .run(...keys.map((k) => fields[k]), recurringId)
    }
    return { ok: true }
  })

  app.delete('/recurring/:id', async (req) => {
    const { id: recurringId } = req.params as { id: string }
    const result = app.db
      .prepare('DELETE FROM recurring_transactions WHERE id = ? AND household_id = ?')
      .run(recurringId, req.user.household_id)
    if (result.changes === 0) notFound('Recurring transaction')
    app.db.prepare('UPDATE transactions SET recurring_id = NULL WHERE recurring_id = ?').run(recurringId)
    return { ok: true }
  })
}

function currentRow(app: FastifyInstance, recurringId: string): Record<string, unknown> {
  const row = app.db
    .prepare(
      `SELECT description, amount_cents, category_id, payer_user_id, splits, cadence, day_of_month, notes
       FROM recurring_transactions WHERE id = ?`,
    )
    .get(recurringId) as Record<string, unknown> & { splits: string }
  return { ...row, splits: JSON.parse(row.splits) }
}
