import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Trip, TripDetailResponse, TripExpense, TripListItem, TripStop } from '@fold/shared'
import { badRequest, id, notFound, now, today } from '../lib/util.js'
import { insertTransaction } from './transactions.js'

const DATE = /^\d{4}-\d{2}-\d{2}$/

const tripBody = z.object({
  name: z.string().trim().min(1).max(100),
  emoji: z.string().max(8).nullish(),
  status: z.enum(['idea', 'planned', 'active', 'done']).default('idea'),
  location: z.string().max(200).nullish(),
  start_date: z.string().regex(DATE).nullish(),
  end_date: z.string().regex(DATE).nullish(),
  total_budget_cents: z.number().int().min(0).nullish(),
  notes: z.string().max(2000).nullish(),
})

const tripCategoryBody = z.object({
  name: z.string().trim().min(1).max(60),
  budget_cents: z.number().int().min(0).default(0),
})

const stopBody = z.object({
  name: z.string().trim().min(1).max(100),
  location: z.string().max(200).nullish(),
  arrive_date: z.string().regex(DATE).nullish(),
  depart_date: z.string().regex(DATE).nullish(),
  lodging: z.string().max(200).nullish(),
  notes: z.string().max(2000).nullish(),
})

const expenseBody = z.object({
  name: z.string().trim().min(1).max(120),
  trip_category_id: z.string().nullish(),
  stop_id: z.string().nullish(),
  planned_cents: z.number().int().min(0).default(0),
  actual_cents: z.number().int().min(0).nullish(),
  date: z.string().regex(DATE).nullish(),
  payer_user_id: z.string().nullish(),
  notes: z.string().max(1000).nullish(),
})

const postBody = z.object({
  category_id: z.string(),
  payer_user_id: z.string(),
  splits: z.array(z.object({ user_id: z.string(), share_cents: z.number().int().min(0) })).min(1),
})

const DEFAULT_TRIP_CATEGORIES = ['Lodging', 'Transport', 'Food', 'Activities', 'Other']

function tripForHousehold(app: FastifyInstance, tripId: string, householdId: string): Trip {
  const trip = app.db
    .prepare(
      `SELECT id, name, emoji, status, location, start_date, end_date, total_budget_cents, notes
       FROM trips WHERE id = ? AND household_id = ?`,
    )
    .get(tripId, householdId) as Trip | undefined
  if (!trip) notFound('Trip')
  return trip!
}

function tripRollups(app: FastifyInstance, tripIds: string[]): Map<string, { planned: number; spent: number }> {
  const map = new Map<string, { planned: number; spent: number }>()
  if (tripIds.length === 0) return map
  const placeholders = tripIds.map(() => '?').join(',')
  const rows = app.db
    .prepare(
      `SELECT trip_id, SUM(planned_cents) AS planned, SUM(COALESCE(actual_cents, 0)) AS spent
       FROM trip_expenses WHERE trip_id IN (${placeholders}) GROUP BY trip_id`,
    )
    .all(...tripIds) as { trip_id: string; planned: number; spent: number }[]
  for (const row of rows) {
    map.set(row.trip_id, { planned: row.planned ?? 0, spent: row.spent ?? 0 })
  }
  return map
}

export async function tripRoutes(app: FastifyInstance): Promise<void> {
  app.get('/trips', async (req): Promise<{ trips: TripListItem[] }> => {
    const trips = app.db
      .prepare(
        `SELECT id, name, emoji, status, location, start_date, end_date, total_budget_cents, notes
         FROM trips WHERE household_id = ?
         ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 WHEN 'idea' THEN 2 ELSE 3 END,
                  start_date IS NULL, start_date, created_at DESC`,
      )
      .all(req.user.household_id) as unknown as Trip[]
    const budgets = app.db
      .prepare(
        `SELECT trip_id, SUM(budget_cents) AS total FROM trip_categories
         WHERE trip_id IN (SELECT id FROM trips WHERE household_id = ?) GROUP BY trip_id`,
      )
      .all(req.user.household_id) as { trip_id: string; total: number }[]
    const rollups = tripRollups(app, trips.map((t) => t.id))
    return {
      trips: trips.map((t) => ({
        ...t,
        budget_cents: t.total_budget_cents ?? budgets.find((b) => b.trip_id === t.id)?.total ?? 0,
        planned_cents: rollups.get(t.id)?.planned ?? 0,
        spent_cents: rollups.get(t.id)?.spent ?? 0,
      })),
    }
  })

  app.post('/trips', async (req) => {
    const body = tripBody.parse(req.body)
    const tripId = id()
    app.db
      .prepare(
        `INSERT INTO trips (id, household_id, name, emoji, status, location, start_date, end_date, total_budget_cents, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tripId,
        req.user.household_id,
        body.name,
        body.emoji ?? null,
        body.status,
        body.location ?? null,
        body.start_date ?? null,
        body.end_date ?? null,
        body.total_budget_cents ?? null,
        body.notes ?? null,
        now(),
      )
    DEFAULT_TRIP_CATEGORIES.forEach((name, index) => {
      app.db
        .prepare('INSERT INTO trip_categories (id, trip_id, name, budget_cents, sort) VALUES (?, ?, ?, 0, ?)')
        .run(id(), tripId, name, index)
    })
    return { id: tripId }
  })

  app.get('/trips/:id', async (req): Promise<TripDetailResponse> => {
    const { id: tripId } = req.params as { id: string }
    const trip = tripForHousehold(app, tripId, req.user.household_id)
    const categories = app.db
      .prepare('SELECT id, trip_id, name, budget_cents, sort FROM trip_categories WHERE trip_id = ? ORDER BY sort')
      .all(tripId) as unknown as { id: string; trip_id: string; name: string; budget_cents: number; sort: number }[]
    const stops = app.db
      .prepare(
        `SELECT id, trip_id, sort, name, location, arrive_date, depart_date, lodging, notes
         FROM trip_stops WHERE trip_id = ? ORDER BY sort`,
      )
      .all(tripId) as unknown as TripStop[]
    const expenses = app.db
      .prepare(
        `SELECT id, trip_id, trip_category_id, stop_id, name, planned_cents, actual_cents, date, payer_user_id, posted_transaction_id, notes
         FROM trip_expenses WHERE trip_id = ? ORDER BY date IS NULL, date, name`,
      )
      .all(tripId) as unknown as TripExpense[]

    const categoryRows = categories.map((cat) => ({
      ...cat,
      planned_cents: expenses
        .filter((e) => e.trip_category_id === cat.id)
        .reduce((sum, e) => sum + e.planned_cents, 0),
      spent_cents: expenses
        .filter((e) => e.trip_category_id === cat.id)
        .reduce((sum, e) => sum + (e.actual_cents ?? 0), 0),
    }))
    const categoryBudget = categories.reduce((sum, c) => sum + c.budget_cents, 0)
    return {
      trip,
      categories: categoryRows,
      stops,
      expenses,
      totals: {
        budget_cents: trip.total_budget_cents ?? categoryBudget,
        planned_cents: expenses.reduce((sum, e) => sum + e.planned_cents, 0),
        spent_cents: expenses.reduce((sum, e) => sum + (e.actual_cents ?? 0), 0),
        budget_source: trip.total_budget_cents != null ? 'total' : 'categories',
      },
    }
  })

  app.patch('/trips/:id', async (req) => {
    const { id: tripId } = req.params as { id: string }
    tripForHousehold(app, tripId, req.user.household_id)
    const body = tripBody.partial().parse(req.body)
    const fields: Record<string, string | number | null> = {}
    for (const key of ['name', 'emoji', 'status', 'location', 'start_date', 'end_date', 'total_budget_cents', 'notes'] as const) {
      if (body[key] !== undefined) fields[key] = body[key] ?? null
    }
    const keys = Object.keys(fields)
    if (keys.length > 0) {
      const assignments = keys.map((k) => `${k} = ?`).join(', ')
      app.db.prepare(`UPDATE trips SET ${assignments} WHERE id = ?`).run(...keys.map((k) => fields[k]), tripId)
    }
    return { ok: true }
  })

  app.delete('/trips/:id', async (req) => {
    const { id: tripId } = req.params as { id: string }
    tripForHousehold(app, tripId, req.user.household_id)
    app.db.prepare('DELETE FROM trips WHERE id = ?').run(tripId)
    return { ok: true }
  })

  app.post('/trips/:id/categories', async (req) => {
    const { id: tripId } = req.params as { id: string }
    tripForHousehold(app, tripId, req.user.household_id)
    const body = tripCategoryBody.parse(req.body)
    const categoryId = id()
    const maxSort = (
      app.db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM trip_categories WHERE trip_id = ?').get(tripId) as {
        s: number
      }
    ).s
    app.db
      .prepare('INSERT INTO trip_categories (id, trip_id, name, budget_cents, sort) VALUES (?, ?, ?, ?, ?)')
      .run(categoryId, tripId, body.name, body.budget_cents, maxSort + 1)
    return { id: categoryId }
  })

  app.patch('/trip-categories/:id', async (req) => {
    const { id: categoryId } = req.params as { id: string }
    const row = app.db
      .prepare(
        `SELECT tc.id FROM trip_categories tc JOIN trips t ON t.id = tc.trip_id
         WHERE tc.id = ? AND t.household_id = ?`,
      )
      .get(categoryId, req.user.household_id)
    if (!row) notFound('Trip category')
    const body = tripCategoryBody.partial().parse(req.body)
    if (body.name !== undefined) {
      app.db.prepare('UPDATE trip_categories SET name = ? WHERE id = ?').run(body.name, categoryId)
    }
    if (body.budget_cents !== undefined) {
      app.db.prepare('UPDATE trip_categories SET budget_cents = ? WHERE id = ?').run(body.budget_cents, categoryId)
    }
    return { ok: true }
  })

  app.delete('/trip-categories/:id', async (req) => {
    const { id: categoryId } = req.params as { id: string }
    const result = app.db
      .prepare(
        `DELETE FROM trip_categories WHERE id = ? AND trip_id IN (SELECT id FROM trips WHERE household_id = ?)`,
      )
      .run(categoryId, req.user.household_id)
    if (result.changes === 0) notFound('Trip category')
    return { ok: true }
  })

  app.post('/trips/:id/stops', async (req) => {
    const { id: tripId } = req.params as { id: string }
    tripForHousehold(app, tripId, req.user.household_id)
    const body = stopBody.parse(req.body)
    const stopId = id()
    const maxSort = (
      app.db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM trip_stops WHERE trip_id = ?').get(tripId) as {
        s: number
      }
    ).s
    app.db
      .prepare(
        `INSERT INTO trip_stops (id, trip_id, sort, name, location, arrive_date, depart_date, lodging, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        stopId,
        tripId,
        maxSort + 1,
        body.name,
        body.location ?? null,
        body.arrive_date ?? null,
        body.depart_date ?? null,
        body.lodging ?? null,
        body.notes ?? null,
      )
    return { id: stopId }
  })

  app.patch('/trip-stops/:id', async (req) => {
    const { id: stopId } = req.params as { id: string }
    const row = app.db
      .prepare(
        `SELECT ts.id FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id
         WHERE ts.id = ? AND t.household_id = ?`,
      )
      .get(stopId, req.user.household_id)
    if (!row) notFound('Stop')
    const body = stopBody.partial().parse(req.body)
    const fields: Record<string, string | null> = {}
    for (const key of ['name', 'location', 'arrive_date', 'depart_date', 'lodging', 'notes'] as const) {
      if (body[key] !== undefined) fields[key] = body[key] ?? null
    }
    const keys = Object.keys(fields)
    if (keys.length > 0) {
      const assignments = keys.map((k) => `${k} = ?`).join(', ')
      app.db.prepare(`UPDATE trip_stops SET ${assignments} WHERE id = ?`).run(...keys.map((k) => fields[k]), stopId)
    }
    return { ok: true }
  })

  app.delete('/trip-stops/:id', async (req) => {
    const { id: stopId } = req.params as { id: string }
    const result = app.db
      .prepare(`DELETE FROM trip_stops WHERE id = ? AND trip_id IN (SELECT id FROM trips WHERE household_id = ?)`)
      .run(stopId, req.user.household_id)
    if (result.changes === 0) notFound('Stop')
    return { ok: true }
  })

  app.post('/trips/:id/stops/reorder', async (req) => {
    const { id: tripId } = req.params as { id: string }
    tripForHousehold(app, tripId, req.user.household_id)
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body)
    const update = app.db.prepare('UPDATE trip_stops SET sort = ? WHERE id = ? AND trip_id = ?')
    ids.forEach((stopId, index) => update.run(index, stopId, tripId))
    return { ok: true }
  })

  app.post('/trips/:id/expenses', async (req) => {
    const { id: tripId } = req.params as { id: string }
    tripForHousehold(app, tripId, req.user.household_id)
    const body = expenseBody.parse(req.body)
    const expenseId = id()
    app.db
      .prepare(
        `INSERT INTO trip_expenses (id, trip_id, trip_category_id, stop_id, name, planned_cents, actual_cents, date, payer_user_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        expenseId,
        tripId,
        body.trip_category_id ?? null,
        body.stop_id ?? null,
        body.name,
        body.planned_cents,
        body.actual_cents ?? null,
        body.date ?? null,
        body.payer_user_id ?? null,
        body.notes ?? null,
      )
    return { id: expenseId }
  })

  app.patch('/trip-expenses/:id', async (req) => {
    const { id: expenseId } = req.params as { id: string }
    const row = app.db
      .prepare(
        `SELECT te.id FROM trip_expenses te JOIN trips t ON t.id = te.trip_id
         WHERE te.id = ? AND t.household_id = ?`,
      )
      .get(expenseId, req.user.household_id)
    if (!row) notFound('Trip expense')
    const body = expenseBody.partial().parse(req.body)
    const fields: Record<string, string | number | null> = {}
    for (const key of ['name', 'trip_category_id', 'stop_id', 'planned_cents', 'actual_cents', 'date', 'payer_user_id', 'notes'] as const) {
      if (body[key] !== undefined) fields[key] = body[key] ?? null
    }
    const keys = Object.keys(fields)
    if (keys.length > 0) {
      const assignments = keys.map((k) => `${k} = ?`).join(', ')
      app.db.prepare(`UPDATE trip_expenses SET ${assignments} WHERE id = ?`).run(...keys.map((k) => fields[k]), expenseId)
    }
    return { ok: true }
  })

  app.delete('/trip-expenses/:id', async (req) => {
    const { id: expenseId } = req.params as { id: string }
    const row = app.db
      .prepare(
        `SELECT te.id FROM trip_expenses te JOIN trips t ON t.id = te.trip_id
         WHERE te.id = ? AND t.household_id = ?`,
      )
      .get(expenseId, req.user.household_id)
    if (!row) notFound('Trip expense')
    app.db.prepare('UPDATE transactions SET trip_expense_id = NULL WHERE trip_expense_id = ?').run(expenseId)
    app.db.prepare('DELETE FROM trip_expenses WHERE id = ?').run(expenseId)
    return { ok: true }
  })

  app.post('/trip-expenses/:id/post', async (req) => {
    const { id: expenseId } = req.params as { id: string }
    const expense = app.db
      .prepare(
        `SELECT te.*, t.name AS trip_name FROM trip_expenses te JOIN trips t ON t.id = te.trip_id
         WHERE te.id = ? AND t.household_id = ?`,
      )
      .get(expenseId, req.user.household_id) as (TripExpense & { trip_name: string }) | undefined
    if (!expense) notFound('Trip expense')
    if (expense!.posted_transaction_id) badRequest('This expense is already in the budget.')
    if (expense!.actual_cents == null || expense!.actual_cents <= 0) {
      badRequest('Record the actual amount spent before posting to the budget.')
    }
    const body = postBody.parse(req.body)
    const total = body.splits.reduce((sum, s) => sum + s.share_cents, 0)
    if (total !== expense!.actual_cents) badRequest('Split shares must add up to the actual amount.')
    const category = app.db
      .prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?')
      .get(body.category_id, req.user.household_id)
    if (!category) badRequest('Unknown category.')

    const txId = insertTransaction(app, req.user.household_id, {
      kind: 'expense',
      date: expense!.date ?? today(),
      description: `${expense!.trip_name}: ${expense!.name}`,
      amount_cents: expense!.actual_cents!,
      category_id: body.category_id,
      payer_user_id: body.payer_user_id,
      trip_expense_id: expenseId,
      splits: body.splits,
    })
    app.db.prepare('UPDATE trip_expenses SET posted_transaction_id = ? WHERE id = ?').run(txId, expenseId)
    return { transaction_id: txId }
  })
}
