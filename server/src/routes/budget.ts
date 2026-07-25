import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { BudgetCategoryRow, BudgetResponse, Category, SplitRule } from '@fold/shared'
import { splitByWeights } from '@fold/shared'
import { getMembers } from '../lib/queries.js'
import { badRequest, id, monthRange, notFound } from '../lib/util.js'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

const allocationBody = z.object({
  category_id: z.string(),
  amount_cents: z.number().int().min(0),
})

const categoryBody = z.object({
  name: z.string().trim().min(1).max(60),
  emoji: z.string().max(8).nullish(),
  scope: z.enum(['shared', 'personal']),
  owner_user_id: z.string().nullish(),
})

const categoryPatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  emoji: z.string().max(8).nullish().optional(),
  archived: z.union([z.literal(0), z.literal(1)]).optional(),
})

function assertMonth(month: string): void {
  if (!MONTH.test(month)) badRequest('Month must look like 2026-07.')
}

export async function budgetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/categories', async (req): Promise<{ categories: Category[] }> => {
    const categories = app.db
      .prepare(
        `SELECT id, name, emoji, scope, owner_user_id, sort, archived
         FROM categories WHERE household_id = ? AND archived = 0 ORDER BY sort, name`,
      )
      .all(req.user.household_id) as unknown as Category[]
    return { categories }
  })

  app.get('/budget/:month', async (req): Promise<BudgetResponse> => {
    const { month } = req.params as { month: string }
    assertMonth(month)
    const householdId = req.user.household_id
    const hh = app.db
      .prepare('SELECT split_rule, custom_split FROM households WHERE id = ?')
      .get(householdId) as { split_rule: SplitRule; custom_split: string | null }
    const members = getMembers(app.db, householdId)
    const { start, end } = monthRange(month)

    const categories = app.db
      .prepare(
        `SELECT id, name, emoji, scope, owner_user_id, sort, archived
         FROM categories WHERE household_id = ? AND archived = 0 ORDER BY sort, name`,
      )
      .all(householdId) as unknown as Category[]
    const allocations = app.db
      .prepare(
        `SELECT a.category_id, a.amount_cents FROM allocations a
         JOIN categories c ON c.id = a.category_id
         WHERE c.household_id = ? AND a.month = ?`,
      )
      .all(householdId, month) as { category_id: string; amount_cents: number }[]
    const spent = app.db
      .prepare(
        `SELECT category_id, SUM(amount_cents) AS total FROM transactions
         WHERE household_id = ? AND kind = 'expense' AND date >= ? AND date < ?
         GROUP BY category_id`,
      )
      .all(householdId, start, end) as { category_id: string | null; total: number }[]

    const rows: BudgetCategoryRow[] = categories.map((cat) => ({
      ...cat,
      allocated_cents: allocations.find((a) => a.category_id === cat.id)?.amount_cents ?? 0,
      spent_cents: spent.find((s) => s.category_id === cat.id)?.total ?? 0,
    }))

    const sharedRows = rows.filter((r) => r.scope === 'shared')
    const shared_allocated_cents = sharedRows.reduce((sum, r) => sum + r.allocated_cents, 0)
    const shared_spent_cents = sharedRows.reduce((sum, r) => sum + r.spent_cents, 0)

    const custom = hh.custom_split ? (JSON.parse(hh.custom_split) as Record<string, number>) : null
    const weights = members.map((m) => ({
      user_id: m.id,
      weight:
        hh.split_rule === 'equal'
          ? 1
          : hh.split_rule === 'custom'
            ? Math.round((custom?.[m.id] ?? 100 / members.length) * 100)
            : m.monthly_income_cents,
    }))
    const contributions = splitByWeights(shared_allocated_cents, weights)

    const memberRows = members.map((m) => {
      const personal = rows.filter((r) => r.scope === 'personal' && r.owner_user_id === m.id)
      const personal_allocated_cents = personal.reduce((sum, r) => sum + r.allocated_cents, 0)
      const personal_spent_cents = personal.reduce((sum, r) => sum + r.spent_cents, 0)
      const contribution_cents = contributions.find((c) => c.user_id === m.id)?.share_cents ?? 0
      return {
        id: m.id,
        name: m.name,
        color: m.color,
        monthly_income_cents: m.monthly_income_cents,
        contribution_cents,
        personal_allocated_cents,
        personal_spent_cents,
        left_cents: m.monthly_income_cents - contribution_cents - personal_allocated_cents,
      }
    })

    return {
      month,
      split_rule: hh.split_rule,
      custom_split: custom,
      members: memberRows,
      categories: rows,
      shared_allocated_cents,
      shared_spent_cents,
      has_allocations: allocations.length > 0,
    }
  })

  app.put('/budget/:month/allocations', async (req) => {
    const { month } = req.params as { month: string }
    assertMonth(month)
    const body = allocationBody.parse(req.body)
    const category = app.db
      .prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?')
      .get(body.category_id, req.user.household_id)
    if (!category) notFound('Category')
    app.db
      .prepare(
        `INSERT INTO allocations (id, category_id, month, amount_cents) VALUES (?, ?, ?, ?)
         ON CONFLICT (category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
      )
      .run(id(), body.category_id, month, body.amount_cents)
    return { ok: true }
  })

  app.post('/budget/:month/copy', async (req) => {
    const { month } = req.params as { month: string }
    assertMonth(month)
    const { from } = z.object({ from: z.string().regex(MONTH) }).parse(req.body)
    const previous = app.db
      .prepare(
        `SELECT a.category_id, a.amount_cents FROM allocations a
         JOIN categories c ON c.id = a.category_id
         WHERE c.household_id = ? AND a.month = ?`,
      )
      .all(req.user.household_id, from) as { category_id: string; amount_cents: number }[]
    const upsert = app.db.prepare(
      `INSERT INTO allocations (id, category_id, month, amount_cents) VALUES (?, ?, ?, ?)
       ON CONFLICT (category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
    )
    for (const alloc of previous) {
      upsert.run(id(), alloc.category_id, month, alloc.amount_cents)
    }
    return { copied: previous.length }
  })

  app.post('/categories', async (req) => {
    const body = categoryBody.parse(req.body)
    if (body.scope === 'personal') {
      if (!body.owner_user_id) badRequest('Personal categories need an owner.')
      const owner = app.db
        .prepare('SELECT id FROM users WHERE id = ? AND household_id = ?')
        .get(body.owner_user_id, req.user.household_id)
      if (!owner) badRequest('That person is not in your household.')
    }
    const categoryId = id()
    const maxSort = (
      app.db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM categories WHERE household_id = ?').get(
        req.user.household_id,
      ) as { s: number }
    ).s
    app.db
      .prepare(
        'INSERT INTO categories (id, household_id, name, emoji, scope, owner_user_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        categoryId,
        req.user.household_id,
        body.name,
        body.emoji ?? null,
        body.scope,
        body.scope === 'personal' ? body.owner_user_id! : null,
        maxSort + 1,
      )
    return { id: categoryId }
  })

  app.patch('/categories/:id', async (req) => {
    const { id: categoryId } = req.params as { id: string }
    const body = categoryPatch.parse(req.body)
    const row = app.db
      .prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?')
      .get(categoryId, req.user.household_id)
    if (!row) notFound('Category')
    if (body.name !== undefined) {
      app.db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(body.name, categoryId)
    }
    if (body.emoji !== undefined) {
      app.db.prepare('UPDATE categories SET emoji = ? WHERE id = ?').run(body.emoji ?? null, categoryId)
    }
    if (body.archived !== undefined) {
      app.db.prepare('UPDATE categories SET archived = ? WHERE id = ?').run(body.archived, categoryId)
    }
    return { ok: true }
  })

  app.delete('/categories/:id', async (req) => {
    const { id: categoryId } = req.params as { id: string }
    const row = app.db
      .prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?')
      .get(categoryId, req.user.household_id)
    if (!row) notFound('Category')
    const used = (
      app.db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?').get(categoryId) as { c: number }
    ).c
    if (used > 0) {
      app.db.prepare('UPDATE categories SET archived = 1 WHERE id = ?').run(categoryId)
      return { archived: true }
    }
    app.db.prepare('DELETE FROM allocations WHERE category_id = ?').run(categoryId)
    app.db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId)
    return { deleted: true }
  })
}
