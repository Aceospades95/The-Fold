import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { BalancesResponse, Tx } from '@fold/shared'
import { getBalances, getTransactions } from '../lib/queries.js'
import { insertTransactionRaw, normalizeLines, writeLines } from '../lib/tx.js'
import { getSetting, putSetting } from '../lib/webhooks.js'
import { badRequest, id, monthRange, notFound } from '../lib/util.js'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

const splitSchema = z.object({
  user_id: z.string(),
  share_cents: z.number().int(),
})

const lineSchema = z.object({
  category_id: z.string().nullish(),
  amount_cents: z.number().int().refine((v) => v !== 0, 'Line amounts cannot be zero'),
  note: z.string().max(200).nullish(),
})

const txBody = z.object({
  date: z.string().regex(DATE),
  description: z.string().trim().min(1).max(200),
  /** Positive = expense; negative = refund/credit. */
  amount_cents: z.number().int().refine((v) => v !== 0, 'Amount cannot be zero'),
  category_id: z.string().nullish(),
  payer_user_id: z.string(),
  account_id: z.string().nullish(),
  merchant_id: z.string().nullish(),
  splits: z.array(splitSchema).min(1),
  /** Optional per-category breakdown; must add up to amount_cents. */
  lines: z.array(lineSchema).min(1).max(30).optional(),
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
  const sign = Math.sign(body.amount_cents)
  if (body.splits.some((s) => s.share_cents !== 0 && Math.sign(s.share_cents) !== sign)) {
    badRequest('Split shares must match the direction of the amount.')
  }
  if (body.account_id) {
    const account = app.db
      .prepare('SELECT id FROM accounts WHERE id = ? AND household_id = ?')
      .get(body.account_id, householdId)
    if (!account) badRequest('Unknown account.')
  }

  const categoryIds = [
    ...(body.category_id ? [body.category_id] : []),
    ...(body.lines ?? []).map((line) => line.category_id).filter((value): value is string => !!value),
  ]
  for (const categoryId of categoryIds) {
    const category = app.db
      .prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?')
      .get(categoryId, householdId)
    if (!category) badRequest('Unknown category.')
  }
  if (body.lines) {
    const lineTotal = body.lines.reduce((sum, line) => sum + line.amount_cents, 0)
    if (lineTotal !== body.amount_cents) {
      badRequest('Category amounts must add up to the total amount.')
    }
  }
  if (body.merchant_id) {
    const merchant = app.db
      .prepare('SELECT id FROM merchants WHERE id = ? AND household_id = ?')
      .get(body.merchant_id, householdId)
    if (!merchant) badRequest('Unknown store.')
  }
}

/** Same amount within ±3 days — the shape of a manual-vs-import double entry. */
export function findLikelyDuplicate(
  app: FastifyInstance,
  householdId: string,
  row: { date: string; amount_cents: number },
  excludeId?: string,
): { id: string; date: string; description: string; amount_cents: number; payer_user_id: string; imported: boolean } | null {
  const match = app.db
    .prepare(
      `SELECT id, date, description, amount_cents, payer_user_id, import_hash FROM transactions
       WHERE household_id = ? AND kind = 'expense' AND amount_cents = ?
         AND date BETWEEN date(?, '-3 day') AND date(?, '+3 day')
         AND id != ?
       ORDER BY import_hash IS NULL DESC, date LIMIT 1`,
    )
    .get(householdId, row.amount_cents, row.date, row.date, excludeId ?? '') as
    | { id: string; date: string; description: string; amount_cents: number; payer_user_id: string; import_hash: string | null }
    | undefined
  if (!match) return null
  const { import_hash, ...rest } = match
  return { ...rest, imported: import_hash != null }
}

function tokenSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 2))
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const token of ta) if (tb.has(token)) shared += 1
  return shared / Math.min(ta.size, tb.size)
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
    const query = z
      .object({
        month: z.string().regex(MONTH).optional(),
        uncategorized: z.coerce.boolean().optional(),
        uncleared: z.coerce.boolean().optional(),
        q: z.string().trim().max(100).optional(),
        category: z.string().optional(),
        account: z.string().optional(),
        payer: z.string().optional(),
      })
      .parse(req.query)
    if (query.uncategorized) {
      return {
        transactions: getTransactions(app.db, req.user.household_id, { uncategorizedOnly: true, limit: 300 }),
      }
    }
    if (query.uncleared) {
      // The reconcile view: every pending entry for one account, any month.
      return {
        transactions: getTransactions(app.db, req.user.household_id, {
          unclearedOnly: true,
          accountId: query.account || undefined,
          limit: 300,
        }),
      }
    }
    const filters = {
      q: query.q || undefined,
      categoryId: query.category || undefined,
      accountId: query.account || undefined,
      payerId: query.payer || undefined,
    }
    const filtering = Object.values(filters).some(Boolean)
    const range = query.month ? monthRange(query.month) : {}
    return {
      transactions: getTransactions(app.db, req.user.household_id, {
        ...range,
        ...filters,
        // A text/entity search should look across everything, not one month.
        ...(filtering && !query.month ? { limit: 300 } : {}),
      }),
    }
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
        `UPDATE transactions SET date = ?, description = ?, amount_cents = ?, payer_user_id = ?, account_id = ?, merchant_id = ?, notes = ?
         WHERE id = ?`,
      )
      .run(
        body.date,
        body.description,
        body.amount_cents,
        body.payer_user_id,
        body.account_id ?? null,
        body.merchant_id ?? null,
        body.notes ?? null,
        txId,
      )
    app.db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(txId)
    const insertSplit = app.db.prepare(
      'INSERT INTO transaction_splits (id, transaction_id, user_id, share_cents) VALUES (?, ?, ?, ?)',
    )
    for (const split of body.splits) {
      insertSplit.run(id(), txId, split.user_id, split.share_cents)
    }
    writeLines(app.db, txId, normalizeLines({ ...body, kind: 'expense' } as never))
    return { ok: true }
  })

  /**
   * Assign categories without touching anything else — powers the
   * "needs a category" queue after an import.
   */
  app.patch('/transactions/:id/categories', async (req) => {
    const { id: txId } = req.params as { id: string }
    const existing = app.db
      .prepare('SELECT id, amount_cents FROM transactions WHERE id = ? AND household_id = ?')
      .get(txId, req.user.household_id) as { id: string; amount_cents: number } | undefined
    if (!existing) notFound('Transaction')
    const { lines } = z.object({ lines: z.array(lineSchema).min(1).max(30) }).parse(req.body)
    const total = lines.reduce((sum, line) => sum + line.amount_cents, 0)
    if (total !== existing!.amount_cents) badRequest('Category amounts must add up to the total amount.')
    for (const line of lines) {
      if (!line.category_id) continue
      const category = app.db
        .prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?')
        .get(line.category_id, req.user.household_id)
      if (!category) badRequest('Unknown category.')
    }
    writeLines(app.db, txId, lines)
    return { ok: true }
  })

  /** Reconciliation ticks: flip one or many transactions between pending and cleared. */
  app.post('/transactions/set-cleared', async (req) => {
    const { ids, cleared } = z
      .object({ ids: z.array(z.string()).min(1).max(500), cleared: z.boolean() })
      .parse(req.body)
    const placeholders = ids.map(() => '?').join(',')
    const result = app.db
      .prepare(`UPDATE transactions SET cleared = ? WHERE household_id = ? AND id IN (${placeholders})`)
      .run(cleared ? 1 : 0, req.user.household_id, ...ids)
    return { updated: Number(result.changes) }
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

  /** Pre-flight check for the import wizard and the add-expense modal. */
  app.post('/transactions/check-duplicates', async (req) => {
    const { rows } = z
      .object({
        rows: z
          .array(z.object({ date: z.string().regex(DATE), amount_cents: z.number().int() }))
          .min(1)
          .max(2000),
      })
      .parse(req.body)
    return {
      matches: rows.map((row) =>
        row.amount_cents === 0 ? null : findLikelyDuplicate(app, req.user.household_id, row),
      ),
    }
  })

  /** Sweep for existing lookalikes: same amount, ≤3 days apart, plausible pair. */
  app.get('/transactions/duplicates', async (req) => {
    const dismissed = new Set(
      getSetting<string[]>(app.db, req.user.household_id, 'dup_dismissed') ?? [],
    )
    const candidates = app.db
      .prepare(
        `SELECT a.id AS a_id, a.date AS a_date, a.description AS a_desc, a.amount_cents AS amount,
                a.payer_user_id AS a_payer, a.import_hash AS a_hash,
                b.id AS b_id, b.date AS b_date, b.description AS b_desc,
                b.payer_user_id AS b_payer, b.import_hash AS b_hash
         FROM transactions a
         JOIN transactions b
           ON b.household_id = a.household_id AND b.kind = 'expense'
          AND b.amount_cents = a.amount_cents AND b.id > a.id
          AND abs(julianday(b.date) - julianday(a.date)) <= 3
         WHERE a.household_id = ? AND a.kind = 'expense' AND a.amount_cents > 0
         LIMIT 200`,
      )
      .all(req.user.household_id) as {
      a_id: string
      a_date: string
      a_desc: string
      amount: number
      a_payer: string
      a_hash: string | null
      b_id: string
      b_date: string
      b_desc: string
      b_payer: string
      b_hash: string | null
    }[]

    const pairs = candidates
      .filter((c) => !dismissed.has([c.a_id, c.b_id].sort().join(':')))
      // Two imported rows with distinct hashes are usually genuinely separate
      // charges — only pair them when the descriptions clearly agree.
      .filter((c) => c.a_hash == null || c.b_hash == null || tokenSimilarity(c.a_desc, c.b_desc) >= 0.5)
      .slice(0, 25)
      .map((c) => ({
        a: { id: c.a_id, date: c.a_date, description: c.a_desc, amount_cents: c.amount, payer_user_id: c.a_payer, imported: c.a_hash != null },
        b: { id: c.b_id, date: c.b_date, description: c.b_desc, amount_cents: c.amount, payer_user_id: c.b_payer, imported: c.b_hash != null },
      }))
    return { pairs }
  })

  /** "These aren't duplicates" — remember the decision. */
  app.post('/transactions/duplicates/dismiss', async (req) => {
    const { a, b } = z.object({ a: z.string(), b: z.string() }).parse(req.body)
    const key = [a, b].sort().join(':')
    const dismissed = getSetting<string[]>(app.db, req.user.household_id, 'dup_dismissed') ?? []
    if (!dismissed.includes(key)) {
      putSetting(app.db, req.user.household_id, 'dup_dismissed', [...dismissed, key].slice(-500))
    }
    return { ok: true }
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
