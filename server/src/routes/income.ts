import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { IncomeSource } from '@fold/shared'
import { badRequest, id, notFound } from '../lib/util.js'

const cadence = z.enum(['monthly', 'semimonthly', 'biweekly', 'weekly', 'annual'])

const createBody = z.object({
  user_id: z.string(),
  name: z.string().trim().min(1).max(80),
  amount_cents: z.number().int().min(0),
  cadence,
  notes: z.string().max(500).nullish(),
})

const patchBody = createBody.partial().omit({ user_id: true }).extend({
  active: z.union([z.literal(0), z.literal(1)]).optional(),
})

export async function incomeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/income', async (req): Promise<{ sources: IncomeSource[] }> => {
    const sources = app.db
      .prepare(
        `SELECT i.id, i.user_id, i.name, i.amount_cents, i.cadence, i.active, i.notes
         FROM income_sources i JOIN users u ON u.id = i.user_id
         WHERE u.household_id = ? ORDER BY i.name`,
      )
      .all(req.user.household_id) as unknown as IncomeSource[]
    return { sources }
  })

  app.post('/income', async (req) => {
    const body = createBody.parse(req.body)
    const owner = app.db
      .prepare('SELECT id FROM users WHERE id = ? AND household_id = ?')
      .get(body.user_id, req.user.household_id)
    if (!owner) badRequest('That person is not in your household.')
    const sourceId = id()
    app.db
      .prepare('INSERT INTO income_sources (id, user_id, name, amount_cents, cadence, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sourceId, body.user_id, body.name, body.amount_cents, body.cadence, body.notes ?? null)
    return { id: sourceId }
  })

  app.patch('/income/:id', async (req) => {
    const body = patchBody.parse(req.body)
    const { id: sourceId } = req.params as { id: string }
    const row = app.db
      .prepare(
        `SELECT i.id FROM income_sources i JOIN users u ON u.id = i.user_id
         WHERE i.id = ? AND u.household_id = ?`,
      )
      .get(sourceId, req.user.household_id)
    if (!row) notFound('Income source')
    const fields: Record<string, string | number | null> = {}
    if (body.name !== undefined) fields.name = body.name
    if (body.amount_cents !== undefined) fields.amount_cents = body.amount_cents
    if (body.cadence !== undefined) fields.cadence = body.cadence
    if (body.notes !== undefined) fields.notes = body.notes ?? null
    if (body.active !== undefined) fields.active = body.active
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
}
