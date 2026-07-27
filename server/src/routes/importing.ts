import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ImportRule } from '@fold/shared'
import { insertTransactionRaw } from '../lib/tx.js'
import { badRequest, id, notFound, now } from '../lib/util.js'

const splitSchema = z.object({ user_id: z.string(), share_cents: z.number().int().min(0) })

const importBody = z.object({
  payer_user_id: z.string(),
  rows: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        description: z.string().trim().min(1).max(300),
        amount_cents: z.number().int().positive(),
        category_id: z.string().nullish(),
        splits: z.array(splitSchema).min(1),
        lines: z
          .array(z.object({ category_id: z.string().nullish(), amount_cents: z.number().int().positive() }))
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

export function importHash(date: string, amountCents: number, description: string): string {
  const normalized = description.toLowerCase().replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(`${date}|${amountCents}|${normalized}`).digest('hex')
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.post('/transactions/import', async (req) => {
    const body = importBody.parse(req.body)
    const householdId = req.user.household_id
    const memberIds = (
      app.db.prepare('SELECT id FROM users WHERE household_id = ?').all(householdId) as { id: string }[]
    ).map((m) => m.id)
    if (!memberIds.includes(body.payer_user_id)) badRequest('Payer is not in your household.')

    const categoryIds = new Set(
      (app.db.prepare('SELECT id FROM categories WHERE household_id = ?').all(householdId) as { id: string }[]).map(
        (c) => c.id,
      ),
    )

    let imported = 0
    let skipped = 0
    for (const row of body.rows) {
      const total = row.splits.reduce((sum, s) => sum + s.share_cents, 0)
      if (total !== row.amount_cents) badRequest(`Splits for "${row.description}" don't add up to the amount.`)
      for (const split of row.splits) {
        if (!memberIds.includes(split.user_id)) badRequest('Split member is not in your household.')
      }
      if (row.category_id && !categoryIds.has(row.category_id)) badRequest('Unknown category.')
      if (row.lines) {
        const lineTotal = row.lines.reduce((sum, line) => sum + line.amount_cents, 0)
        if (lineTotal !== row.amount_cents) badRequest(`Category amounts for "${row.description}" don't add up.`)
        for (const line of row.lines) {
          if (line.category_id && !categoryIds.has(line.category_id)) badRequest('Unknown category.')
        }
      }

      const hash = importHash(row.date, row.amount_cents, row.description)
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
        import_hash: hash,
        splits: row.splits,
        lines: row.lines,
      })
      imported += 1
    }
    return { imported, skipped }
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
}
