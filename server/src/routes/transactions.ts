import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { BalancesResponse, Tx } from '@fold/shared'
import { getBalances, getTransactions } from '../lib/queries.js'
import { insertTransactionRaw } from '../lib/tx.js'
import { badRequest, id, monthRange, notFound } from '../lib/util.js'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

const splitSchema = z.object({
  user_id: z.string(),
  share_cents: z.number().int().min(0),
})

const txBody = z.object({
  date: z.string().regex(DATE),
  description: z.string().trim().min(1).max(200),
  amount_cents: z.number().int().positive(),
  category_id: z.string().nullish(),
  payer_user_id: z.string(),
  splits: z.array(splitSchema).min(1),
  notes: z.string().max(1000).nullish(),
})

const settleBody = z.object({
  from_user_id: z.string(),
  to_user_id: z.string(),
  amount_cents: z.number().int().positive(),
  date: z.string().regex(DATE),
})

function validateTxParticipants(
  app: FastifyInstance,
  householdId: string,
  body: z.infer<typeof txBody>,
): void {
  const memberIds = (
    app.db.prepare('SELECT id FROM users WHERE household_id = ?').all(householdId) as { id: string }[]
  ).map((m) => m.id)
  if (!memberIds.includes(body.payer_user_id)) badRequest('Payer is not in your household.')
  for (const split of body.splits) {
    if (!memberIds.includes(split.user_id)) badRequest('Split member is not in your household.')
  }
  const uniqueUsers = new Set(body.splits.map((s) => s.user_id))
  if (uniqueUsers.size !== body.splits.length) badRequest('Each person can appear in the split only once.')
  const total = body.splits.reduce((sum, s) => sum + s.share_cents, 0)
  if (total !== body.amount_cents) badRequest('Split shares must add up to the total amount.')
  if (body.category_id) {
    const category = app.db
      .prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?')
      .get(body.category_id, householdId)
    if (!category) badRequest('Unknown category.')
  }
}

export function insertTransaction(
  app: FastifyInstance,
  householdId: string,
  input: Parameters<typeof insertTransactionRaw>[2],
): string {
  return insertTransactionRaw(app.db, householdId, input)
}

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/transactions', async (req): Promise<{ transactions: Tx[] }> => {
    const query = z.object({ month: z.string().regex(MONTH).optional() }).parse(req.query)
    const range = query.month ? monthRange(query.month) : {}
    return { transactions: getTransactions(app.db, req.user.household_id, range) }
  })

  app.post('/transactions', async (req) => {
    const body = txBody.parse(req.body)
    validateTxParticipants(app, req.user.household_id, body)
    const txId = insertTransaction(app, req.user.household_id, { ...body, kind: 'expense' })
    return { id: txId }
  })

  app.patch('/transactions/:id', async (req) => {
    const { id: txId } = req.params as { id: string }
    const body = txBody.parse(req.body)
    const existing = app.db
      .prepare("SELECT id, kind FROM transactions WHERE id = ? AND household_id = ?")
      .get(txId, req.user.household_id) as { id: string; kind: string } | undefined
    if (!existing) notFound('Transaction')
    if (existing!.kind !== 'expense') badRequest('Settlements cannot be edited — delete and re-record instead.')
    validateTxParticipants(app, req.user.household_id, body)
    app.db
      .prepare(
        `UPDATE transactions SET date = ?, description = ?, amount_cents = ?, category_id = ?, payer_user_id = ?, notes = ?
         WHERE id = ?`,
      )
      .run(body.date, body.description, body.amount_cents, body.category_id ?? null, body.payer_user_id, body.notes ?? null, txId)
    app.db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(txId)
    const insertSplit = app.db.prepare(
      'INSERT INTO transaction_splits (id, transaction_id, user_id, share_cents) VALUES (?, ?, ?, ?)',
    )
    for (const split of body.splits) {
      insertSplit.run(id(), txId, split.user_id, split.share_cents)
    }
    return { ok: true }
  })

  app.delete('/transactions/:id', async (req) => {
    const { id: txId } = req.params as { id: string }
    const existing = app.db
      .prepare('SELECT id FROM transactions WHERE id = ? AND household_id = ?')
      .get(txId, req.user.household_id)
    if (!existing) notFound('Transaction')
    app.db.prepare('UPDATE trip_expenses SET posted_transaction_id = NULL WHERE posted_transaction_id = ?').run(txId)
    app.db.prepare('DELETE FROM transactions WHERE id = ?').run(txId)
    return { ok: true }
  })

  app.get('/balances', async (req): Promise<BalancesResponse> => {
    return getBalances(app.db, req.user.household_id)
  })

  app.post('/settle', async (req) => {
    const body = settleBody.parse(req.body)
    if (body.from_user_id === body.to_user_id) badRequest('Pick two different people.')
    const memberIds = (
      app.db.prepare('SELECT id FROM users WHERE household_id = ?').all(req.user.household_id) as { id: string }[]
    ).map((m) => m.id)
    if (!memberIds.includes(body.from_user_id) || !memberIds.includes(body.to_user_id)) {
      badRequest('Both people must be in your household.')
    }
    const fromName = (
      app.db.prepare('SELECT name FROM users WHERE id = ?').get(body.from_user_id) as { name: string }
    ).name
    const toName = (app.db.prepare('SELECT name FROM users WHERE id = ?').get(body.to_user_id) as { name: string })
      .name
    const txId = insertTransaction(app, req.user.household_id, {
      kind: 'settlement',
      date: body.date,
      description: `${fromName} paid ${toName}`,
      amount_cents: body.amount_cents,
      payer_user_id: body.from_user_id,
      splits: [{ user_id: body.to_user_id, share_cents: body.amount_cents }],
    })
    return { id: txId }
  })
}
