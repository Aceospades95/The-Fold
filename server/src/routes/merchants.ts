import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Merchant } from '@fold/shared'
import { badRequest, id, notFound, now } from '../lib/util.js'

const merchantBody = z.object({
  name: z.string().trim().min(1).max(80),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Domain should look like costco.com')
    .nullish(),
})

export async function merchantRoutes(app: FastifyInstance): Promise<void> {
  /** All stores with usage stats and their most-used category (for suggestions). */
  app.get('/merchants', async (req): Promise<{ merchants: Merchant[] }> => {
    const merchants = app.db
      .prepare(
        `SELECT m.id, m.name, m.domain,
                (SELECT COUNT(*) FROM transactions t WHERE t.merchant_id = m.id) AS uses,
                (SELECT tl.category_id FROM transaction_lines tl
                   JOIN transactions t ON t.id = tl.transaction_id
                   WHERE t.merchant_id = m.id AND tl.category_id IS NOT NULL
                   GROUP BY tl.category_id ORDER BY COUNT(*) DESC LIMIT 1) AS top_category_id,
                (SELECT MAX(t.date) FROM transactions t WHERE t.merchant_id = m.id) AS last_date
         FROM merchants m WHERE m.household_id = ?
         ORDER BY uses DESC, m.name`,
      )
      .all(req.user.household_id) as unknown as Merchant[]
    return { merchants }
  })

  app.post('/merchants', async (req) => {
    const body = merchantBody.parse(req.body)
    const existing = app.db
      .prepare('SELECT id FROM merchants WHERE household_id = ? AND LOWER(name) = LOWER(?)')
      .get(req.user.household_id, body.name) as { id: string } | undefined
    if (existing) return { id: existing.id, existed: true }
    const merchantId = id()
    app.db
      .prepare('INSERT INTO merchants (id, household_id, name, domain, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(merchantId, req.user.household_id, body.name, body.domain ?? null, now())
    return { id: merchantId, existed: false }
  })

  app.patch('/merchants/:id', async (req) => {
    const { id: merchantId } = req.params as { id: string }
    const row = app.db
      .prepare('SELECT id FROM merchants WHERE id = ? AND household_id = ?')
      .get(merchantId, req.user.household_id)
    if (!row) notFound('Store')
    const body = merchantBody.partial().parse(req.body)
    if (body.name !== undefined) {
      if (!body.name) badRequest('A store needs a name.')
      app.db.prepare('UPDATE merchants SET name = ? WHERE id = ?').run(body.name, merchantId)
    }
    if (body.domain !== undefined) {
      app.db.prepare('UPDATE merchants SET domain = ? WHERE id = ?').run(body.domain ?? null, merchantId)
    }
    return { ok: true }
  })

  app.delete('/merchants/:id', async (req) => {
    const { id: merchantId } = req.params as { id: string }
    const result = app.db
      .prepare('DELETE FROM merchants WHERE id = ? AND household_id = ?')
      .run(merchantId, req.user.household_id)
    if (result.changes === 0) notFound('Store')
    return { ok: true }
  })
}
