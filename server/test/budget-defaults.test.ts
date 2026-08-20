import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PlanState } from '@fold/shared'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { createLinkedHousehold } from './helpers.js'

let app: FastifyInstance
let cookie: { fold_session: string }
let rentId: string
let groceriesId: string

const now = new Date()
const monthAt = (delta: number): string =>
  `${new Date(now.getFullYear(), now.getMonth() + delta, 1).getFullYear()}-${String(new Date(now.getFullYear(), now.getMonth() + delta, 1).getMonth() + 1).padStart(2, '0')}`
const M0 = monthAt(0)
const M1 = monthAt(1)
const M2 = monthAt(2)
const M3 = monthAt(3)
const PREV = monthAt(-1)

async function get(url: string): Promise<any> {
  const res = await app.inject({ method: 'GET', url, cookies: cookie })
  expect(res.statusCode).toBe(200)
  return res.json()
}

async function applyPlan(month: string, mode: 'default' | 'month', amounts: { rent: number; groceries: number }): Promise<any> {
  const { state } = (await get('/api/plan')) as { state: PlanState }
  state.cats = [
    { id: 'p-rent', name: 'Rent / Mortgage', mode: 'fixed', amt: amounts.rent, benefit_a: 50, fold_category_id: rentId },
    { id: 'p-groc', name: 'Groceries', mode: 'fixed', amt: amounts.groceries, benefit_a: 50, fold_category_id: groceriesId },
  ]
  const res = await app.inject({ method: 'POST', url: '/api/plan/apply', cookies: cookie, payload: { month, mode, state } })
  expect(res.statusCode).toBe(200)
  return res.json()
}

function allocOf(budget: any, categoryId: string): number {
  return budget.categories.find((c: { id: string }) => c.id === categoryId)?.allocated_cents ?? 0
}

beforeAll(async () => {
  app = await buildApp({ db: openDb(':memory:'), logger: false })
  const linked = await createLinkedHousehold(app, ['Jake', 'Sam'], 'defaults.dev')
  cookie = linked.cookie
  const categories = (await get('/api/categories')).categories
  rentId = categories.find((c: { name: string }) => c.name === 'Rent / Mortgage').id
  groceriesId = categories.find((c: { name: string }) => c.name === 'Groceries').id
})

afterAll(async () => {
  await app.close()
})

describe('default budgets with an effective month', () => {
  it('fills the effective month and later months as they are viewed, never earlier ones', async () => {
    const r = await applyPlan(M0, 'default', { rent: 2000, groceries: 600 })
    expect(r.mode).toBe('default')

    const current = await get(`/api/budget/${M0}`)
    expect(allocOf(current, rentId)).toBe(200000)
    expect(allocOf(current, groceriesId)).toBe(60000)
    expect(current.default_effective).toBe(M0)

    // A future month materializes the moment someone looks at it.
    const next = await get(`/api/budget/${M1}`)
    expect(allocOf(next, rentId)).toBe(200000)
    expect(next.default_effective).toBe(M0)

    // History stays empty — the default starts at its effective month.
    const previous = await get(`/api/budget/${PREV}`)
    expect(allocOf(previous, rentId)).toBe(0)
    expect(previous.default_effective).toBeNull()
  })

  it('a new default refreshes untouched months from its start on, keeping hand-set rows and older months', async () => {
    // Hand-tune groceries next month — that row is now the humans' call.
    await app.inject({
      method: 'PUT',
      url: `/api/budget/${M1}/allocations`,
      cookies: cookie,
      payload: { category_id: groceriesId, amount_cents: 70000 },
    })

    await applyPlan(M1, 'default', { rent: 2100, groceries: 650 })

    const next = await get(`/api/budget/${M1}`)
    expect(allocOf(next, rentId)).toBe(210000) // refreshed to the new default
    expect(allocOf(next, groceriesId)).toBe(70000) // hand-set survives
    expect(next.default_effective).toBe(M1)

    // The current month sits before the new default's start — old numbers hold.
    const current = await get(`/api/budget/${M0}`)
    expect(allocOf(current, rentId)).toBe(200000)
    expect(current.default_effective).toBe(M0)
  })

  it('a one-month apply overrides the default for that month alone', async () => {
    const r = await applyPlan(M2, 'month', { rent: 1800, groceries: 500 })
    expect(r.mode).toBe('month')

    const overridden = await get(`/api/budget/${M2}`)
    expect(allocOf(overridden, rentId)).toBe(180000)
    expect(allocOf(overridden, groceriesId)).toBe(50000)

    // The month after falls back to the standing default.
    const after = await get(`/api/budget/${M3}`)
    expect(allocOf(after, rentId)).toBe(210000)
    expect(allocOf(after, groceriesId)).toBe(65000)

    // And a later default rollout does not disturb the hand-applied month.
    await applyPlan(M1, 'default', { rent: 2200, groceries: 660 })
    const still = await get(`/api/budget/${M2}`)
    expect(allocOf(still, rentId)).toBe(180000)
    const refreshed = await get(`/api/budget/${M3}`)
    expect(allocOf(refreshed, rentId)).toBe(220000)
  })

  it('carries the defaults in the full export', async () => {
    const dump = (await get('/api/export/full.json')) as { budget_defaults: { from_month: string }[] }
    const months = dump.budget_defaults.map((d) => d.from_month)
    expect(months).toContain(M0)
    expect(months).toContain(M1)
  })
})
