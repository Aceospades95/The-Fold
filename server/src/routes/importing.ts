import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ImportBatch, ImportProfile, ImportRule } from '@fold/shared'
import { insertTransactionRaw } from '../lib/tx.js'
import { putSetting } from '../lib/webhooks.js'
import { badRequest, id, notFound, now, today } from '../lib/util.js'

const splitSchema = z.object({ user_id: z.string(), share_cents: z.number().int() })

const importBody = z.object({
  payer_user_id: z.string(),
  account_id: z.string().nullish(),
  filename: z.string().max(200).nullish(),
  /** From an OFX ledger balance — snapshots the account after import. */
  account_balance_cents: z.number().int().nullish(),
  balance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  rows: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        description: z.string().trim().min(1).max(300),
        /** Negative = credit/refund on the statement. */
        amount_cents: z.number().int().refine((v) => v !== 0, 'Amount cannot be zero'),
        /** Bank-provided transaction id (OFX FITID) — the strongest dedupe key. */
        external_id: z.string().max(120).nullish(),
        category_id: z.string().nullish(),
        merchant_id: z.string().nullish(),
        splits: z.array(splitSchema).min(1),
        lines: z
          .array(z.object({ category_id: z.string().nullish(), amount_cents: z.number().int() }))
          .min(1)
          .max(30)
          .optional(),
      }),
    )
    .min(1)
    .max(2000),
})

const ruleBody = z.object({
  match_text: z.string().trim().min(2).max(100),
  category_id: z.string().nullish(),
  split_mode: z.enum(['none', 'equal', 'income', 'owed']).default('equal'),
})

const profileBody = z.object({
  date_col: z.number().int().min(0),
  desc_col: z.number().int().min(0),
  amount_col: z.number().int().min(0),
  has_header: z.boolean(),
  negative_is_spending: z.boolean(),
  payer_user_id: z.string().nullable(),
  default_mode: z.enum(['none', 'equal', 'income', 'owed']),
  include_credits: z.boolean(),
})

export function importHash(date: string, amountCents: number, description: string): string {
  const normalized = description.toLowerCase().replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(`${date}|${amountCents}|${normalized}`).digest('hex')
}

function externalHash(accountId: string | null, externalId: string): string {
  return createHash('sha256').update(`fitid|${accountId ?? ''}|${externalId}`).digest('hex')
}

function profileKey(accountId: string | null): string {
  return `import_profile:${accountId ?? 'default'}`
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.post('/transactions/import', async (req) => {
    const body = importBody.parse(req.body)
    const householdId = req.user.household_id
    const memberIds = (
      app.db.prepare('SELECT id FROM users WHERE household_id = ?').all(householdId) as { id: string }[]
    ).map((m) => m.id)
    if (!memberIds.includes(body.payer_user_id)) badRequest('Payer is not in your household.')
    if (body.account_id) {
      const account = app.db
        .prepare('SELECT id FROM accounts WHERE id = ? AND household_id = ?')
        .get(body.account_id, householdId)
      if (!account) badRequest('Unknown account.')
    }

    const categoryIds = new Set(
      (app.db.prepare('SELECT id FROM categories WHERE household_id = ?').all(householdId) as { id: string }[]).map(
        (c) => c.id,
      ),
    )
    const merchantIds = new Set(
      (app.db.prepare('SELECT id FROM merchants WHERE household_id = ?').all(householdId) as { id: string }[]).map(
        (m) => m.id,
      ),
    )

    const batchId = id()
    app.db
      .prepare(
        'INSERT INTO import_batches (id, household_id, account_id, filename, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(batchId, householdId, body.account_id ?? null, body.filename ?? null, now())

    let imported = 0
    let skipped = 0
    let total = 0
    for (const row of body.rows) {
      const sign = Math.sign(row.amount_cents)
      const total_splits = row.splits.reduce((sum, s) => sum + s.share_cents, 0)
      if (total_splits !== row.amount_cents) badRequest(`Splits for "${row.description}" don't add up to the amount.`)
      if (row.splits.some((s) => s.share_cents !== 0 && Math.sign(s.share_cents) !== sign)) {
        badRequest(`Splits for "${row.description}" must match the amount's direction.`)
      }
      for (const split of row.splits) {
        if (!memberIds.includes(split.user_id)) badRequest('Split member is not in your household.')
      }
      if (row.category_id && !categoryIds.has(row.category_id)) badRequest('Unknown category.')
      if (row.merchant_id && !merchantIds.has(row.merchant_id)) badRequest('Unknown store.')
      if (row.lines) {
        const lineTotal = row.lines.reduce((sum, line) => sum + line.amount_cents, 0)
        if (lineTotal !== row.amount_cents) badRequest(`Category amounts for "${row.description}" don't add up.`)
        for (const line of row.lines) {
          if (line.category_id && !categoryIds.has(line.category_id)) badRequest('Unknown category.')
        }
      }

      const hash = row.external_id
        ? externalHash(body.account_id ?? null, row.external_id)
        : importHash(row.date, row.amount_cents, row.description)
      const existing = app.db
        .prepare('SELECT id FROM transactions WHERE household_id = ? AND import_hash = ?')
        .get(householdId, hash)
      if (existing) {
        skipped += 1
        continue
      }
      insertTransactionRaw(app.db, householdId, {
        kind: 'expense',
        date: row.date,
        description: row.description,
        amount_cents: row.amount_cents,
        category_id: row.category_id ?? null,
        payer_user_id: body.payer_user_id,
        account_id: body.account_id ?? null,
        merchant_id: row.merchant_id ?? null,
        import_batch_id: batchId,
        import_hash: hash,
        splits: row.splits,
        lines: row.lines,
      })
      imported += 1
      total += row.amount_cents
    }

    if (imported === 0) {
      app.db.prepare('DELETE FROM import_batches WHERE id = ?').run(batchId)
      return { imported, skipped, batch_id: null }
    }
    app.db
      .prepare('UPDATE import_batches SET imported_count = ?, total_cents = ? WHERE id = ?')
      .run(imported, total, batchId)

    if (body.account_id && body.account_balance_cents != null) {
      app.db
        .prepare(
          `INSERT INTO account_snapshots (id, account_id, date, balance_cents) VALUES (?, ?, ?, ?)
           ON CONFLICT (account_id, date) DO UPDATE SET balance_cents = excluded.balance_cents`,
        )
        .run(id(), body.account_id, body.balance_date ?? today(), Math.abs(body.account_balance_cents))
    }

    return { imported, skipped, batch_id: batchId }
  })

  app.get('/import-batches', async (req): Promise<{ batches: ImportBatch[] }> => {
    const batches = app.db
      .prepare(
        `SELECT b.id, b.account_id, a.name AS account_name, b.filename, b.created_at, b.imported_count, b.total_cents
         FROM import_batches b LEFT JOIN accounts a ON a.id = b.account_id
         WHERE b.household_id = ? ORDER BY b.created_at DESC LIMIT 12`,
      )
      .all(req.user.household_id) as unknown as ImportBatch[]
    return { batches }
  })

  /** Undo an import: removes every transaction the batch created. */
  app.delete('/import-batches/:id', async (req) => {
    const { id: batchId } = req.params as { id: string }
    const batch = app.db
      .prepare('SELECT id FROM import_batches WHERE id = ? AND household_id = ?')
      .get(batchId, req.user.household_id)
    if (!batch) notFound('Import')
    const result = app.db
      .prepare('DELETE FROM transactions WHERE household_id = ? AND import_batch_id = ?')
      .run(req.user.household_id, batchId)
    app.db.prepare('DELETE FROM import_batches WHERE id = ?').run(batchId)
    return { deleted: result.changes }
  })

  app.get('/import-profiles', async (req): Promise<{ profiles: Record<string, ImportProfile> }> => {
    const rows = app.db
      .prepare(`SELECT key, value FROM settings WHERE household_id = ? AND key LIKE 'import_profile:%'`)
      .all(req.user.household_id) as { key: string; value: string }[]
    const profiles: Record<string, ImportProfile> = {}
    for (const row of rows) {
      profiles[row.key.slice('import_profile:'.length)] = JSON.parse(row.value) as ImportProfile
    }
    return { profiles }
  })

  app.put('/import-profiles/:accountId', async (req) => {
    const { accountId } = req.params as { accountId: string }
    const profile = profileBody.parse(req.body)
    if (accountId !== 'default') {
      const account = app.db
        .prepare('SELECT id FROM accounts WHERE id = ? AND household_id = ?')
        .get(accountId, req.user.household_id)
      if (!account) notFound('Account')
    }
    putSetting(app.db, req.user.household_id, profileKey(accountId === 'default' ? null : accountId), profile)
    return { ok: true }
  })

  app.get('/import-rules', async (req): Promise<{ rules: ImportRule[] }> => {
    const rules = app.db
      .prepare(
        'SELECT id, match_text, category_id, split_mode FROM import_rules WHERE household_id = ? ORDER BY match_text',
      )
      .all(req.user.household_id) as unknown as ImportRule[]
    return { rules }
  })

  app.post('/import-rules', async (req) => {
    const body = ruleBody.parse(req.body)
    if (body.category_id) {
      const category = app.db
        .prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?')
        .get(body.category_id, req.user.household_id)
      if (!category) badRequest('Unknown category.')
    }
    const ruleId = id()
    app.db
      .prepare(
        'INSERT INTO import_rules (id, household_id, match_text, category_id, split_mode, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(ruleId, req.user.household_id, body.match_text, body.category_id ?? null, body.split_mode, now())
    return { id: ruleId }
  })

  app.delete('/import-rules/:id', async (req) => {
    const { id: ruleId } = req.params as { id: string }
    const result = app.db
      .prepare('DELETE FROM import_rules WHERE id = ? AND household_id = ?')
      .run(ruleId, req.user.household_id)
    if (result.changes === 0) notFound('Rule')
    return { ok: true }
  })

  /** Getting-started helper: does this household have any imports yet? */
  app.get('/import-status', async (req) => {
    const count = (
      app.db.prepare('SELECT COUNT(*) AS c FROM import_batches WHERE household_id = ?').get(
        req.user.household_id,
      ) as { c: number }
    ).c
    return { batches: count }
  })
}
