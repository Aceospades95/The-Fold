import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { getBalances } from '../lib/queries.js'
import { badRequest, id, notFound, now } from '../lib/util.js'
import { hashApiToken } from './integrations.js'

/**
 * Token-authenticated mini-API for Home Assistant, shortcuts, and scripts.
 * Create tokens in Settings → Integrations; send them as
 * `Authorization: Bearer fold_...`. Household-scoped, deliberately small surface.
 */

const addItemBody = z.object({
  list: z.string().trim().min(1),
  text: z.string().trim().min(1).max(300),
})

function householdForToken(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply): string | null {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    reply.code(401).send({ error: 'Missing bearer token' })
    return null
  }
  const row = app.db
    .prepare('SELECT id, household_id FROM api_tokens WHERE token_hash = ?')
    .get(hashApiToken(token)) as { id: string; household_id: string } | undefined
  if (!row) {
    reply.code(401).send({ error: 'Invalid token' })
    return null
  }
  app.db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now(), row.id)
  return row.household_id
}

export async function hookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/hooks/list-items', async (req, reply) => {
    const householdId = householdForToken(app, req, reply)
    if (!householdId) return
    const body = addItemBody.parse(req.body)
    const list = app.db
      .prepare('SELECT id FROM lists WHERE household_id = ? AND (id = ? OR LOWER(name) = LOWER(?)) AND archived = 0')
      .get(householdId, body.list, body.list) as { id: string } | undefined
    if (!list) badRequest(`No list called "${body.list}".`)
    const itemId = id()
    const maxSort = (
      app.db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM list_items WHERE list_id = ?').get(list!.id) as {
        s: number
      }
    ).s
    app.db
      .prepare('INSERT INTO list_items (id, list_id, text, sort, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(itemId, list!.id, body.text, maxSort + 1, now())
    return { id: itemId }
  })

  app.post('/hooks/complete-item', async (req, reply) => {
    const householdId = householdForToken(app, req, reply)
    if (!householdId) return
    const { text } = z.object({ text: z.string().trim().min(1) }).parse(req.body)
    const item = app.db
      .prepare(
        `SELECT li.id FROM list_items li JOIN lists l ON l.id = li.list_id
         WHERE l.household_id = ? AND li.done = 0 AND LOWER(li.text) LIKE LOWER(?)
         ORDER BY li.created_at LIMIT 1`,
      )
      .get(householdId, `%${text}%`) as { id: string } | undefined
    if (!item) notFound('Open item matching that text')
    app.db.prepare('UPDATE list_items SET done = 1, completed_at = ? WHERE id = ?').run(now(), item!.id)
    return { id: item!.id, done: true }
  })

  app.get('/hooks/summary', async (req, reply) => {
    const householdId = householdForToken(app, req, reply)
    if (!householdId) return
    const balances = getBalances(app.db, householdId)
    const openItems = (
      app.db
        .prepare(
          `SELECT COUNT(*) AS c FROM list_items li JOIN lists l ON l.id = li.list_id
           WHERE l.household_id = ? AND li.done = 0`,
        )
        .get(householdId) as { c: number }
    ).c
    const nextTrip = app.db
      .prepare(
        `SELECT name, start_date FROM trips
         WHERE household_id = ? AND status IN ('planned', 'active') AND start_date IS NOT NULL
         ORDER BY start_date LIMIT 1`,
      )
      .get(householdId) as { name: string; start_date: string } | undefined
    return {
      open_items: openItems,
      next_trip: nextTrip ?? null,
      settle_suggestion: balances.suggestion,
    }
  })
}
