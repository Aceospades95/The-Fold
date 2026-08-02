import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ListItemRow, ListRow } from '@fold/shared'
import { badRequest, id, notFound, now } from '../lib/util.js'

const DATE = /^\d{4}-\d{2}-\d{2}$/

const listBody = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['todo', 'chores', 'grocery', 'wishlist', 'custom']).default('todo'),
  emoji: z.string().max(8).nullish(),
})

const itemBody = z.object({
  text: z.string().trim().min(1).max(300),
  notes: z.string().max(1000).nullish(),
  url: z.string().max(500).nullish(),
  amount_cents: z.number().int().min(0).nullish(),
  assignee_user_id: z.string().nullish(),
  due_date: z.string().regex(DATE).nullish(),
})

const itemPatch = itemBody.partial().extend({
  done: z.union([z.literal(0), z.literal(1)]).optional(),
})

function listForHousehold(app: FastifyInstance, listId: string, householdId: string): void {
  const row = app.db.prepare('SELECT id FROM lists WHERE id = ? AND household_id = ?').get(listId, householdId)
  if (!row) notFound('List')
}

export async function listRoutes(app: FastifyInstance): Promise<void> {
  app.get('/lists', async (req): Promise<{ lists: ListRow[] }> => {
    const lists = app.db
      .prepare(
        'SELECT id, name, type, emoji, sort, archived FROM lists WHERE household_id = ? AND archived = 0 ORDER BY sort, name',
      )
      .all(req.user.household_id) as unknown as Omit<ListRow, 'items'>[]
    const items = app.db
      .prepare(
        `SELECT li.* FROM list_items li JOIN lists l ON l.id = li.list_id
         WHERE l.household_id = ? ORDER BY li.done, li.sort, li.created_at`,
      )
      .all(req.user.household_id) as unknown as ListItemRow[]
    return {
      lists: lists.map((list) => ({ ...list, items: items.filter((item) => item.list_id === list.id) })),
    }
  })

  app.post('/lists', async (req) => {
    const body = listBody.parse(req.body)
    const listId = id()
    const maxSort = (
      app.db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM lists WHERE household_id = ?').get(
        req.user.household_id,
      ) as { s: number }
    ).s
    app.db
      .prepare('INSERT INTO lists (id, household_id, name, type, emoji, sort) VALUES (?, ?, ?, ?, ?, ?)')
      .run(listId, req.user.household_id, body.name, body.type, body.emoji ?? null, maxSort + 1)
    return { id: listId }
  })

  app.patch('/lists/:id', async (req) => {
    const { id: listId } = req.params as { id: string }
    listForHousehold(app, listId, req.user.household_id)
    const body = listBody.partial().parse(req.body)
    if (body.name !== undefined) app.db.prepare('UPDATE lists SET name = ? WHERE id = ?').run(body.name, listId)
    if (body.type !== undefined) app.db.prepare('UPDATE lists SET type = ? WHERE id = ?').run(body.type, listId)
    if (body.emoji !== undefined) {
      app.db.prepare('UPDATE lists SET emoji = ? WHERE id = ?').run(body.emoji ?? null, listId)
    }
    return { ok: true }
  })

  app.delete('/lists/:id', async (req) => {
    const { id: listId } = req.params as { id: string }
    listForHousehold(app, listId, req.user.household_id)
    app.db.prepare('DELETE FROM lists WHERE id = ?').run(listId)
    return { ok: true }
  })

  app.post('/lists/:id/items', async (req) => {
    const { id: listId } = req.params as { id: string }
    listForHousehold(app, listId, req.user.household_id)
    const body = itemBody.parse(req.body)
    if (body.assignee_user_id) {
      const member = app.db
        .prepare('SELECT id FROM users WHERE id = ? AND household_id = ?')
        .get(body.assignee_user_id, req.user.household_id)
      if (!member) badRequest('Assignee is not in your household.')
    }
    const itemId = id()
    const maxSort = (
      app.db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM list_items WHERE list_id = ?').get(listId) as {
        s: number
      }
    ).s
    app.db
      .prepare(
        `INSERT INTO list_items (id, list_id, text, notes, url, amount_cents, assignee_user_id, due_date, sort, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        itemId,
        listId,
        body.text,
        body.notes ?? null,
        body.url ?? null,
        body.amount_cents ?? null,
        body.assignee_user_id ?? null,
        body.due_date ?? null,
        maxSort + 1,
        now(),
      )
    return { id: itemId }
  })

  app.patch('/list-items/:id', async (req) => {
    const { id: itemId } = req.params as { id: string }
    const row = app.db
      .prepare(
        `SELECT li.id, li.done FROM list_items li JOIN lists l ON l.id = li.list_id
         WHERE li.id = ? AND l.household_id = ?`,
      )
      .get(itemId, req.user.household_id) as { id: string; done: 0 | 1 } | undefined
    if (!row) notFound('Item')
    const body = itemPatch.parse(req.body)
    const fields: Record<string, string | number | null> = {}
    for (const key of ['text', 'notes', 'url', 'amount_cents', 'assignee_user_id', 'due_date'] as const) {
      if (body[key] !== undefined) fields[key] = body[key] ?? null
    }
    if (body.done !== undefined) {
      fields.done = body.done
      fields.completed_at = body.done === 1 ? now() : null
    }
    const keys = Object.keys(fields)
    if (keys.length > 0) {
      const assignments = keys.map((k) => `${k} = ?`).join(', ')
      app.db.prepare(`UPDATE list_items SET ${assignments} WHERE id = ?`).run(...keys.map((k) => fields[k]), itemId)
    }
    return { ok: true }
  })

  app.delete('/list-items/:id', async (req) => {
    const { id: itemId } = req.params as { id: string }
    const result = app.db
      .prepare(`DELETE FROM list_items WHERE id = ? AND list_id IN (SELECT id FROM lists WHERE household_id = ?)`)
      .run(itemId, req.user.household_id)
    if (result.changes === 0) notFound('Item')
    return { ok: true }
  })

  app.post('/lists/:id/clear-done', async (req) => {
    const { id: listId } = req.params as { id: string }
    listForHousehold(app, listId, req.user.household_id)
    const result = app.db.prepare('DELETE FROM list_items WHERE list_id = ? AND done = 1').run(listId)
    return { cleared: result.changes }
  })
}
