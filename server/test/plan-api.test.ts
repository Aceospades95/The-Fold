import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PlanState } from '@fold/shared'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { createLinkedHousehold, signup } from './helpers.js'

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
  it('seeds the plan from real incomes with their true pay rhythm', async () => {
    const r = await get('/api/plan')
    expect(r.bootstrapped).toBe(true)
    const state: PlanState = r.state
    const jake = state.people[0]
    // One biweekly source: annual salary with the paycheck rhythm preserved.
    expect(jake.pay_type).toBe('salary')
    expect(jake.salary).toBe(91000)
    expect(jake.pay_freq).toBe('biweekly')
    // 210/paycheck 401k = 5,460/yr = 6% of gross.
    expect(jake.k401_pct).toBeCloseTo(6, 1)
    // Withheld taxes seed the manual rate: 13,000 / 91,000 ≈ 14.3%.
    expect(jake.manual_tax_pct).toBeCloseTo(14.3, 1)
    // Medical became a §125 item; the tax line was skipped.
    expect(jake.items).toHaveLength(1)
    expect(jake.items[0].type).toBe('s125')
    expect(state.people[1]).toMatchObject({ salary: 48000, pay_freq: 'monthly' })

    const groceries = state.cats.find((c) => c.name === 'Groceries')
    expect(groceries).toBeTruthy()
    expect(groceries!.amt).toBe(150) // 450 over 3 months
    expect(groceries!.mode).toBe('fixed')
    expect(groceries!.fold_category_id).toBeTruthy()
  })
})

describe('plan persistence & scenarios', () => {
  it('saves, round-trips, and stamps who saved', async () => {
    const { state } = await get('/api/plan')
    state.trip_goal = 8000
    state.alloc_locked = ['savings']
    state.people[0].next_payday = '2026-09-04'
    const put = await app.inject({ method: 'PUT', url: '/api/plan', cookies: cookie, payload: { state } })
    expect(put.statusCode).toBe(200)
    const back = await get('/api/plan')
    expect(back.state.trip_goal).toBe(8000)
    expect(back.state.alloc_locked).toEqual(['savings'])
    expect(back.state.people[0].next_payday).toBe('2026-09-04')
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

describe('partner auto-link', () => {
  it('a generic partner adopts the real one when they sign up, keeping the modeled numbers', async () => {
    const solo = await buildApp({ db: openDb(':memory:'), logger: false })
    try {
      const jake = await signup(solo, { name: 'Jacob', email: 'jacob@link.dev' })
      // Model a not-yet-signed-up partner with real numbers.
      const boot = (await solo.inject({ method: 'GET', url: '/api/plan', cookies: jake.cookie })).json()
      const state: PlanState = boot.state
      expect(state.people[1].user_id).toBeNull()
      state.people[1].name = 'Partner'
      state.people[1].pay_type = 'hourly'
      state.people[1].hourly_rate = 32.5
      state.people[1].hours_per_week = 40
      state.people[1].pay_freq = 'biweekly'
      state.people[1].k401_pct = 4
      await solo.inject({ method: 'PUT', url: '/api/plan', cookies: jake.cookie, payload: { state } })

      // She signs up with an invite; the plan should claim her automatically.
      const invite = (await solo.inject({ method: 'POST', url: '/api/invites', cookies: jake.cookie })).json()
      const sanya = await signup(solo, { name: 'Sanya Lee', email: 'sanya@link.dev', invite_code: invite.code })

      const linked = (await solo.inject({ method: 'GET', url: '/api/plan', cookies: jake.cookie })).json()
      const partner = linked.state.people[1]
      expect(partner.user_id).toBe(sanya.userId)
      expect(partner.name).toBe('Sanya')
      // The modeled numbers survived the hand-off.
      expect(partner.pay_type).toBe('hourly')
      expect(partner.hourly_rate).toBe(32.5)
      expect(partner.pay_freq).toBe('biweekly')
      expect(partner.k401_pct).toBe(4)
    } finally {
      await solo.close()
    }
  })
})

describe('apply plan to budget', () => {
  it('writes planned amounts into the month’s allocations, creating missing categories', async () => {
    const { state } = await get('/api/plan')
    const groceries = state.cats.find((c: { name: string }) => c.name === 'Groceries')
    groceries.amt = 600
    groceries.mode = 'fixed'
    state.cats.push({ id: 'new1', name: 'Date night', mode: 'pct', amt: 5, benefit_a: 50 })
    await app.inject({ method: 'PUT', url: '/api/plan', cookies: cookie, payload: { state } })

    const result = (
      await app.inject({ method: 'POST', url: '/api/plan/apply', cookies: cookie, payload: { month } })
    ).json()
    expect(result.created).toBe(1)
    expect(result.applied).toBeGreaterThanOrEqual(2)

    const budget = await get(`/api/budget/${month}`)
    const g = budget.categories.find((c: { name: string; scope: string }) => c.name === 'Groceries' && c.scope === 'shared')
    expect(g.allocated_cents).toBe(60000)
    const dateNight = budget.categories.find((c: { name: string }) => c.name === 'Date night')
    expect(dateNight).toBeTruthy()
    expect(dateNight.scope).toBe('shared')
    // 5% of the pool, in cents.
    const { computePlan: compute } = await import('@fold/shared')
    const expected = Math.round(compute(state).pool_mo * 0.05 * 100)
    expect(dateNight.allocated_cents).toBe(expected)

    // The plan remembered the link it created.
    const after = await get('/api/plan')
    const linkedCat = after.state.cats.find((c: { name: string }) => c.name === 'Date night')
    expect(linkedCat.fold_category_id).toBe(dateNight.id)
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
