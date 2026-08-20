import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { BudgetResponse, Category, CategoryDetailResponse, CategoryGroup, TrendsResponse } from '@fold/shared'
import { categoryDetail, computeBudget, computeTrends, quickFillAmount } from '../lib/budget.js'
import { badRequest, id, notFound } from '../lib/util.js'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

const CATEGORY_COLUMNS = `id, name, emoji, scope, owner_user_id, group_id, rollover, target_cents, target_type, target_date, bucket, notes, sort, archived`

const allocationBody = z.object({
  category_id: z.string(),
  amount_cents: z.number().int(),
})

const targetFields = {
  rollover: z.union([z.literal(0), z.literal(1)]).optional(),
  target_type: z.enum(['none', 'monthly', 'by_date']).optional(),
  target_cents: z.number().int().min(0).nullish(),
  target_date: z.string().regex(DATE).nullish(),
  bucket: z.enum(['need', 'want', 'save']).nullish(),
  group_id: z.string().nullish(),
  notes: z.string().max(500).nullish(),
}

const categoryBody = z.object({
  name: z.string().trim().min(1).max(60),
  emoji: z.string().max(8).nullish(),
  scope: z.enum(['shared', 'personal']),
  owner_user_id: z.string().nullish(),
  ...targetFields,
})

const categoryPatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  emoji: z.string().max(8).nullish().optional(),
  archived: z.union([z.literal(0), z.literal(1)]).optional(),
  ...targetFields,
})

const groupBody = z.object({
  name: z.string().trim().min(1).max(60),
  emoji: z.string().max(8).nullish(),
})

const moveBody = z.object({
  from_category_id: z.string().nullable(),
  to_category_id: z.string(),
  amount_cents: z.number().int().positive(),
})

const quickFillBody = z.object({
  strategy: z.enum(['last_month', 'avg3', 'spent_last_month', 'targets']),
  scope: z.enum(['shared', 'personal', 'all']).default('all'),
  owner_user_id: z.string().nullish(),
  only_empty: z.boolean().default(false),
})

function assertMonth(month: string): void {
  if (!MONTH.test(month)) badRequest('Month must look like 2026-07.')
}

function ownedCategory(app: FastifyInstance, categoryId: string, householdId: string): void {
  const row = app.db
    .prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?')
    .get(categoryId, householdId)
  if (!row) notFound('Category')
}

export function setAllocation(app: FastifyInstance, categoryId: string, month: string, amountCents: number): void {
  app.db
    .prepare(
      `INSERT INTO allocations (id, category_id, month, amount_cents) VALUES (?, ?, ?, ?)
       ON CONFLICT (category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
    )
    .run(id(), categoryId, month, Math.max(0, amountCents))
}

export async function budgetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/categories', async (req): Promise<{ categories: Category[]; groups: CategoryGroup[] }> => {
    const categories = app.db
      .prepare(
        `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE household_id = ? AND archived = 0 ORDER BY sort, name`,
      )
      .all(req.user.household_id) as unknown as Category[]
    const groups = app.db
      .prepare('SELECT id, name, emoji, sort FROM category_groups WHERE household_id = ? ORDER BY sort, name')
      .all(req.user.household_id) as unknown as CategoryGroup[]
    return { categories, groups }
  })

  app.get('/budget/:month', async (req): Promise<BudgetResponse> => {
    const { month } = req.params as { month: string }
    assertMonth(month)
    return computeBudget(app.db, req.user.household_id, month)
  })

  app.get('/budget/:month/categories/:id', async (req): Promise<CategoryDetailResponse> => {
    const { month, id: categoryId } = req.params as { month: string; id: string }
    assertMonth(month)
    const detail = categoryDetail(app.db, req.user.household_id, categoryId, month)
    if (!detail) notFound('Category')
    return detail!
  })

  app.get('/budget-trends', async (req): Promise<TrendsResponse> => {
    const { months } = z.object({ months: z.coerce.number().int().min(2).max(24).default(6) }).parse(req.query)
    return computeTrends(app.db, req.user.household_id, months)
  })

  app.put('/budget/:month/allocations', async (req) => {
    const { month } = req.params as { month: string }
    assertMonth(month)
    const body = allocationBody.parse(req.body)
    ownedCategory(app, body.category_id, req.user.household_id)
    setAllocation(app, body.category_id, month, body.amount_cents)
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
         WHERE c.household_id = ? AND a.month = ? AND c.archived = 0`,
      )
      .all(req.user.household_id, from) as { category_id: string; amount_cents: number }[]
    for (const allocation of previous) {
      setAllocation(app, allocation.category_id, month, allocation.amount_cents)
    }
    return { copied: previous.length }
  })

  /** Move budgeted money between envelopes (or fund one from unassigned). */
  app.post('/budget/:month/move', async (req) => {
    const { month } = req.params as { month: string }
    assertMonth(month)
    const body = moveBody.parse(req.body)
    if (body.from_category_id === body.to_category_id) badRequest('Pick two different categories.')
    ownedCategory(app, body.to_category_id, req.user.household_id)

    const budget = computeBudget(app.db, req.user.household_id, month)
    const to = budget.categories.find((c) => c.id === body.to_category_id)!

    if (body.from_category_id) {
      ownedCategory(app, body.from_category_id, req.user.household_id)
      const from = budget.categories.find((c) => c.id === body.from_category_id)
      if (!from) notFound('Category')
      if (from!.allocated_cents < body.amount_cents) {
        badRequest(`${from!.name} only has ${(from!.allocated_cents / 100).toFixed(2)} budgeted this month.`)
      }
      setAllocation(app, from!.id, month, from!.allocated_cents - body.amount_cents)
    }
    setAllocation(app, to.id, month, to.allocated_cents + body.amount_cents)
    return { ok: true }
  })

  /** Bulk-fill allocations from a strategy (last month, 3-month average, targets…). */
  app.post('/budget/:month/quick-fill', async (req) => {
    const { month } = req.params as { month: string }
    assertMonth(month)
    const body = quickFillBody.parse(req.body)
    const budget = computeBudget(app.db, req.user.household_id, month)
    let filled = 0
    for (const row of budget.categories) {
      if (body.scope !== 'all' && row.scope !== body.scope) continue
      if (body.owner_user_id && row.owner_user_id !== body.owner_user_id) continue
      if (body.only_empty && row.allocated_cents > 0) continue
      const amount = quickFillAmount(row, body.strategy)
      if (amount == null || amount === row.allocated_cents) continue
      setAllocation(app, row.id, month, amount)
      filled += 1
    }
    return { filled }
  })

  app.put('/budget/:month/income', async (req) => {
    const { month } = req.params as { month: string }
    assertMonth(month)
    const body = z
      .object({ user_id: z.string(), amount_cents: z.number().int().min(0).nullable() })
      .parse(req.body)
    const member = app.db
      .prepare('SELECT id FROM users WHERE id = ? AND household_id = ?')
      .get(body.user_id, req.user.household_id)
    if (!member) badRequest('That person is not in your household.')
    if (body.amount_cents == null) {
      app.db
        .prepare('DELETE FROM month_incomes WHERE household_id = ? AND user_id = ? AND month = ?')
        .run(req.user.household_id, body.user_id, month)
    } else {
      app.db
        .prepare(
          `INSERT INTO month_incomes (household_id, user_id, month, amount_cents) VALUES (?, ?, ?, ?)
           ON CONFLICT (household_id, user_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
        )
        .run(req.user.household_id, body.user_id, month, body.amount_cents)
    }
    return { ok: true }
  })

  app.post('/category-groups', async (req) => {
    const body = groupBody.parse(req.body)
    const groupId = id()
    const maxSort = (
      app.db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM category_groups WHERE household_id = ?').get(
        req.user.household_id,
      ) as { s: number }
    ).s
    app.db
      .prepare('INSERT INTO category_groups (id, household_id, name, emoji, sort) VALUES (?, ?, ?, ?, ?)')
      .run(groupId, req.user.household_id, body.name, body.emoji ?? null, maxSort + 1)
    return { id: groupId }
  })

  app.patch('/category-groups/:id', async (req) => {
    const { id: groupId } = req.params as { id: string }
    const row = app.db
      .prepare('SELECT id FROM category_groups WHERE id = ? AND household_id = ?')
      .get(groupId, req.user.household_id)
    if (!row) notFound('Group')
    const body = groupBody.partial().extend({ sort: z.number().int().optional() }).parse(req.body)
    if (body.name !== undefined) app.db.prepare('UPDATE category_groups SET name = ? WHERE id = ?').run(body.name, groupId)
    if (body.emoji !== undefined) {
      app.db.prepare('UPDATE category_groups SET emoji = ? WHERE id = ?').run(body.emoji ?? null, groupId)
    }
    if (body.sort !== undefined) app.db.prepare('UPDATE category_groups SET sort = ? WHERE id = ?').run(body.sort, groupId)
    return { ok: true }
  })

  app.delete('/category-groups/:id', async (req) => {
    const { id: groupId } = req.params as { id: string }
    const result = app.db
      .prepare('DELETE FROM category_groups WHERE id = ? AND household_id = ?')
      .run(groupId, req.user.household_id)
    if (result.changes === 0) notFound('Group')
    app.db.prepare('UPDATE categories SET group_id = NULL WHERE group_id = ?').run(groupId)
    return { ok: true }
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
    if (body.target_type === 'by_date' && !body.target_date) badRequest('A by-date target needs a date.')
    if (body.group_id) {
      const group = app.db
        .prepare('SELECT id FROM category_groups WHERE id = ? AND household_id = ?')
        .get(body.group_id, req.user.household_id)
      if (!group) badRequest('Unknown group.')
    }
    const categoryId = id()
    const maxSort = (
      app.db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM categories WHERE household_id = ?').get(
        req.user.household_id,
      ) as { s: number }
    ).s
    app.db
      .prepare(
        `INSERT INTO categories (id, household_id, name, emoji, scope, owner_user_id, group_id, rollover, target_cents, target_type, target_date, bucket, notes, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        categoryId,
        req.user.household_id,
        body.name,
        body.emoji ?? null,
        body.scope,
        body.scope === 'personal' ? body.owner_user_id! : null,
        body.group_id ?? null,
        body.rollover ?? 0,
        body.target_cents ?? null,
        body.target_type ?? 'none',
        body.target_date ?? null,
        body.bucket ?? (body.scope === 'personal' ? 'want' : 'need'),
        body.notes ?? null,
        maxSort + 1,
      )
    return { id: categoryId }
  })

  app.patch('/categories/:id', async (req) => {
    const { id: categoryId } = req.params as { id: string }
    ownedCategory(app, categoryId, req.user.household_id)
    const body = categoryPatch.parse(req.body)
    if (body.group_id) {
      const group = app.db
        .prepare('SELECT id FROM category_groups WHERE id = ? AND household_id = ?')
        .get(body.group_id, req.user.household_id)
      if (!group) badRequest('Unknown group.')
    }
    const fields: Record<string, string | number | null> = {}
    if (body.name !== undefined) fields.name = body.name
    if (body.emoji !== undefined) fields.emoji = body.emoji ?? null
    if (body.archived !== undefined) fields.archived = body.archived
    if (body.group_id !== undefined) fields.group_id = body.group_id ?? null
    if (body.rollover !== undefined) fields.rollover = body.rollover
    if (body.bucket !== undefined) fields.bucket = body.bucket ?? null
    if (body.notes !== undefined) fields.notes = body.notes ?? null
    if (body.target_type !== undefined) {
      fields.target_type = body.target_type
      if (body.target_type === 'none') {
        fields.target_cents = null
        fields.target_date = null
      }
    }
    if (body.target_cents !== undefined) fields.target_cents = body.target_cents ?? null
    if (body.target_date !== undefined) fields.target_date = body.target_date ?? null
    const keys = Object.keys(fields)
    if (keys.length > 0) {
      const assignments = keys.map((k) => `${k} = ?`).join(', ')
      app.db.prepare(`UPDATE categories SET ${assignments} WHERE id = ?`).run(...keys.map((k) => fields[k]), categoryId)
    }
    return { ok: true }
  })

  app.post('/categories/reorder', async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body)
    const update = app.db.prepare('UPDATE categories SET sort = ? WHERE id = ? AND household_id = ?')
    ids.forEach((categoryId, index) => update.run(index, categoryId, req.user.household_id))
    return { ok: true }
  })

  app.delete('/categories/:id', async (req) => {
    const { id: categoryId } = req.params as { id: string }
    ownedCategory(app, categoryId, req.user.household_id)
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
