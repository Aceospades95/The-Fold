import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PlanState } from '@fold/shared'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { createLinkedHousehold } from './helpers.js'

let app: FastifyInstance
let cookie: { fold_session: string }
let jakeId: string
let samId: string

const month = new Date().toISOString().slice(0, 7)

async function get(url: string): Promise<any> {
  const res = await app.inject({ method: 'GET', url, cookies: cookie })
  expect(res.statusCode).toBe(200)
  return res.json()
}

beforeAll(async () => {
  app = await buildApp({ db: openDb(':memory:'), logger: false })
  const linked = await createLinkedHousehold(app, ['Jake', 'Sam'], 'plan.dev')
  cookie = linked.cookie
  jakeId = linked.aId
  samId = linked.bId

  // Jake: biweekly gross 3,500 with taxes (skipped), a 401(k), and medical (→ §125).
  await app.inject({
    method: 'POST',
    url: '/api/income',
    cookies: cookie,
    payload: {
      user_id: jakeId,
      name: 'Salary',
      amount_cents: 0,
      gross_cents: 350000,
      deductions: [
        { name: 'Federal tax', amount_cents: 50000, kind: 'tax' },
        { name: '401(k)', amount_cents: 21000, kind: 'pretax' },
        { name: 'Medical insurance', amount_cents: 6000, kind: 'pretax' },
      ],
      cadence: 'biweekly',
    },
  })
  await app.inject({
    method: 'POST',
    url: '/api/income',
    cookies: cookie,
    payload: { user_id: samId, name: 'Salary', amount_cents: 400000, cadence: 'monthly' },
  })

  // Some shared spending so the bootstrap has category averages.
  const categories = await get('/api/categories')
  const groceries = categories.categories.find(
    (c: { name: string; scope: string }) => c.name === 'Groceries' && c.scope === 'shared',
  )
  await app.inject({
    method: 'POST',
    url: '/api/transactions',
    cookies: cookie,
    payload: {
      date: `${month}-03`,
      description: 'Groceries',
      amount_cents: 45000,
      category_id: groceries.id,
      payer_user_id: jakeId,
      splits: [{ user_id: jakeId, share_cents: 45000 }],
    },
  })
})

afterAll(async () => {
  await app.close()
})

describe('plan bootstrap', () => {
  it('seeds the plan from real incomes, 401k, and category averages', async () => {
    const r = await get('/api/plan')
    expect(r.bootstrapped).toBe(true)
    const state: PlanState = r.state
    const jake = state.people[0]
    // 3,500 × 26 = 91,000 gross annual.
    expect(jake.gross).toBe(91000)
    // 210/paycheck 401k = 5,460/yr = 6% of gross.
    expect(jake.k401_pct).toBeCloseTo(6, 1)
    // Medical became a §125 item; the tax line was skipped.
    expect(jake.items).toHaveLength(1)
    expect(jake.items[0].type).toBe('s125')
    expect(state.people[1].gross).toBe(48000)

    const groceries = state.cats.find((c) => c.name === 'Groceries')
    expect(groceries).toBeTruthy()
    expect(groceries!.amt).toBe(150) // 450 over 3 months
    expect(groceries!.fold_category_id).toBeTruthy()
  })
})

describe('plan persistence & scenarios', () => {
  it('saves, round-trips, and stamps who saved', async () => {
    const { state } = await get('/api/plan')
    state.trip_goal = 8000
    const put = await app.inject({ method: 'PUT', url: '/api/plan', cookies: cookie, payload: { state } })
    expect(put.statusCode).toBe(200)
    const back = await get('/api/plan')
    expect(back.state.trip_goal).toBe(8000)
    expect(back.saved_by).toBe('Jake')
    expect(back.bootstrapped).toBeUndefined()
  })

  it('rejects buckets that do not total 100', async () => {
    const { state } = await get('/api/plan')
    state.alloc = { living: 50, savings: 10, invest: 10, trip: 5, personal: 5 }
    const bad = await app.inject({ method: 'PUT', url: '/api/plan', cookies: cookie, payload: { state } })
    expect(bad.statusCode).toBe(400)
  })

  it('saves, lists, loads, overwrites, and deletes named scenarios', async () => {
    const { state } = await get('/api/plan')
    state.trip_goal = 12000
    await app.inject({
      method: 'POST',
      url: '/api/plan/scenarios',
      cookies: cookie,
      payload: { name: 'Aggressive savings', state },
    })
    let list = await get('/api/plan/scenarios')
    expect(list.scenarios).toHaveLength(1)
    expect(list.scenarios[0]).toMatchObject({ name: 'Aggressive savings', saved_by: 'Jake' })

    const loaded = await get('/api/plan/scenarios/Aggressive%20savings')
    expect(loaded.state.trip_goal).toBe(12000)

    state.trip_goal = 15000
    await app.inject({
      method: 'POST',
      url: '/api/plan/scenarios',
      cookies: cookie,
      payload: { name: 'Aggressive savings', state },
    })
    list = await get('/api/plan/scenarios')
    expect(list.scenarios).toHaveLength(1) // overwrote, not duplicated

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/plan/scenarios/Aggressive%20savings',
      cookies: cookie,
    })
    expect(del.statusCode).toBe(200)
    list = await get('/api/plan/scenarios')
    expect(list.scenarios).toHaveLength(0)
  })
})

describe('plan vs actuals', () => {
  it('reports the month’s shared spending by category', async () => {
    const actuals = await get(`/api/plan/actuals?month=${month}`)
    expect(actuals.shared_total_cents).toBe(45000)
    expect(actuals.by_category[0]).toMatchObject({ name: 'Groceries', total_cents: 45000 })
    expect(actuals.days_in_month).toBeGreaterThanOrEqual(28)
    expect(actuals.today_day).toBeGreaterThanOrEqual(1)
  })
})
