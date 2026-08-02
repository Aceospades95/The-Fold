import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { NetWorthResponse } from '@fold/shared'
import { computeNetWorth } from '../lib/networth.js'
import { badRequest, id, notFound, now, today } from '../lib/util.js'

const accountBody = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['checking', 'savings', 'investment', 'retirement', 'property', 'vehicle', 'credit', 'loan', 'other']),
  owner_user_id: z.string().nullish(),
  balance_cents: z.number().int().min(0).optional(),
})

const balanceBody = z.object({
  balance_cents: z.number().int().min(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function netWorthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/networth', async (req): Promise<NetWorthResponse> => {
    return computeNetWorth(app.db, req.user.household_id)
  })

  app.post('/accounts', async (req) => {
    const body = accountBody.parse(req.body)
    if (body.owner_user_id) {
      const owner = app.db
        .prepare('SELECT id FROM users WHERE id = ? AND household_id = ?')
        .get(body.owner_user_id, req.user.household_id)
      if (!owner) badRequest('That person is not in your household.')
    }
    const accountId = id()
    const maxSort = (
      app.db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM accounts WHERE household_id = ?').get(
        req.user.household_id,
      ) as { s: number }
    ).s
    app.db
      .prepare(
        'INSERT INTO accounts (id, household_id, name, type, owner_user_id, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(accountId, req.user.household_id, body.name, body.type, body.owner_user_id ?? null, maxSort + 1, now())
    if (body.balance_cents !== undefined) {
      app.db
        .prepare('INSERT INTO account_snapshots (id, account_id, date, balance_cents) VALUES (?, ?, ?, ?)')
        .run(id(), accountId, today(), body.balance_cents)
    }
    return { id: accountId }
  })

  app.patch('/accounts/:id', async (req) => {
    const { id: accountId } = req.params as { id: string }
    const existing = app.db
      .prepare('SELECT id FROM accounts WHERE id = ? AND household_id = ?')
      .get(accountId, req.user.household_id)
    if (!existing) notFound('Account')
    const body = accountBody.partial().extend({ archived: z.union([z.literal(0), z.literal(1)]).optional() }).parse(req.body)
    if (body.name !== undefined) app.db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(body.name, accountId)
    if (body.type !== undefined) app.db.prepare('UPDATE accounts SET type = ? WHERE id = ?').run(body.type, accountId)
    if (body.owner_user_id !== undefined) {
      app.db.prepare('UPDATE accounts SET owner_user_id = ? WHERE id = ?').run(body.owner_user_id ?? null, accountId)
    }
    if (body.archived !== undefined) {
      app.db.prepare('UPDATE accounts SET archived = ? WHERE id = ?').run(body.archived, accountId)
    }
    return { ok: true }
  })

  app.delete('/accounts/:id', async (req) => {
    const { id: accountId } = req.params as { id: string }
    const result = app.db
      .prepare('DELETE FROM accounts WHERE id = ? AND household_id = ?')
      .run(accountId, req.user.household_id)
    if (result.changes === 0) notFound('Account')
    return { ok: true }
  })

  app.put('/accounts/:id/balance', async (req) => {
    const { id: accountId } = req.params as { id: string }
    const existing = app.db
      .prepare('SELECT id FROM accounts WHERE id = ? AND household_id = ?')
      .get(accountId, req.user.household_id)
    if (!existing) notFound('Account')
    const body = balanceBody.parse(req.body)
    const date = body.date ?? today()
    app.db
      .prepare(
        `INSERT INTO account_snapshots (id, account_id, date, balance_cents) VALUES (?, ?, ?, ?)
         ON CONFLICT (account_id, date) DO UPDATE SET balance_cents = excluded.balance_cents`,
      )
      .run(id(), accountId, date, body.balance_cents)
    return { ok: true }
  })
}
