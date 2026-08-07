import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { createLinkedHousehold } from './helpers.js'

let app: FastifyInstance
let cookie: { fold_session: string }
let jakeId: string
let samId: string

function localDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const todayStr = localDate(0)
const month = todayStr.slice(0, 7)

async function get(url: string): Promise<any> {
  const res = await app.inject({ method: 'GET', url, cookies: cookie })
  expect(res.statusCode).toBe(200)
  return res.json()
}

beforeAll(async () => {
  app = await buildApp({ db: openDb(':memory:'), logger: false })
  const linked = await createLinkedHousehold(app, ['Jake', 'Sam'], 'insights.dev')
  cookie = linked.cookie
  jakeId = linked.aId
  samId = linked.bId

  await app.inject({
    method: 'POST',
    url: '/api/income',
    cookies: cookie,
    payload: { user_id: jakeId, name: 'Salary', amount_cents: 400000, cadence: 'monthly' },
  })

  const categories = await get('/api/categories')
  const groceries = categories.categories.find(
    (c: { name: string; scope: string }) => c.name === 'Groceries' && c.scope === 'shared',
  )
  const jakeFun = categories.categories.find(
    (c: { name: string; scope: string; owner_user_id: string | null }) =>
      c.name === 'Fun money' && c.owner_user_id === jakeId,
  )
  await app.inject({
    method: 'PUT',
    url: `/api/budget/${month}/allocations`,
    cookies: cookie,
    payload: { category_id: groceries.id, amount_cents: 60000 },
  })

  const store = (
    await app.inject({
      method: 'POST',
      url: '/api/merchants',
      cookies: cookie,
      payload: { name: 'Costco', domain: 'costco.com' },
    })
  ).json()

  // Today: one mixed purchase — 250 shared groceries + 50 of Jake's fun money,
  // split Jake 200 / Sam 100. Anchored to today so it's always in the flow month.
  await app.inject({
    method: 'POST',
    url: '/api/transactions',
    cookies: cookie,
    payload: {
      date: todayStr,
      description: 'Costco mixed run',
      amount_cents: 30000,
      merchant_id: store.id,
      payer_user_id: jakeId,
      splits: [
        { user_id: jakeId, share_cents: 20000 },
        { user_id: samId, share_cents: 10000 },
      ],
      lines: [
        { category_id: groceries.id, amount_cents: 25000 },
        { category_id: jakeFun.id, amount_cents: 5000 },
      ],
    },
  })
  // Two days ago: a second visit to the same store.
  await app.inject({
    method: 'POST',
    url: '/api/transactions',
    cookies: cookie,
    payload: {
      date: localDate(2),
      description: 'Costco again',
      amount_cents: 8000,
      merchant_id: store.id,
      category_id: groceries.id,
      payer_user_id: samId,
      splits: [{ user_id: samId, share_cents: 8000 }],
    },
  })
})

afterAll(async () => {
  await app.close()
})

describe('insights', () => {
  it('aggregates daily activity, habits, and weekday patterns', async () => {
    const insights = await get('/api/insights?months=6')
    expect(insights.months).toBe(6)
    const dailyTotal = insights.daily.reduce((sum: number, d: { total_cents: number }) => sum + d.total_cents, 0)
    expect(dailyTotal).toBe(38000)

    // Two distinct spend days inside the last 30.
    expect(insights.habits.no_spend_days_30).toBe(28)
    expect(insights.habits.longest_no_spend_streak_30).toBeGreaterThanOrEqual(1)
    expect(insights.habits.avg_purchase_cents).toBe(19000)
    expect(insights.habits.autopilot_share_pct).toBe(0)

    const todayDow = new Date().getDay()
    expect(insights.weekday_avg[todayDow]).toBeGreaterThan(0)
    expect(insights.weekday_avg).toHaveLength(7)
  })

  it('tracks the cumulative burn against the assigned budget', async () => {
    const insights = await get('/api/insights')
    expect(insights.burn.budget_cents).toBe(60000)
    expect(insights.burn.this_month).toHaveLength(insights.burn.today_day)
    const last = insights.burn.this_month[insights.burn.this_month.length - 1]
    // Cumulative and non-decreasing; includes at least today's purchase.
    expect(last).toBeGreaterThanOrEqual(30000)
    for (let i = 1; i < insights.burn.this_month.length; i++) {
      expect(insights.burn.this_month[i]).toBeGreaterThanOrEqual(insights.burn.this_month[i - 1])
    }
  })

  it('splits the month flow into shared, personal, and kept per member', async () => {
    const insights = await get('/api/insights')
    const jake = insights.flow.members.find((m: { user_id: string }) => m.user_id === jakeId)
    const sam = insights.flow.members.find((m: { user_id: string }) => m.user_id === samId)
    expect(jake.income_cents).toBe(400000)
    expect(jake.personal_cents).toBe(5000)
    expect(jake.shared_cents).toBe(15000)
    expect(jake.kept_cents).toBe(380000)
    expect(sam.shared_cents).toBeGreaterThan(0)
    expect(insights.flow.shared_total_cents).toBeGreaterThanOrEqual(25000)
  })

  it('feeds the treemap, store ranking, and sparklines', async () => {
    const insights = await get('/api/insights')
    const fun = insights.treemap.find((t: { name: string }) => t.name === 'Fun money')
    expect(fun.group).toContain('Jake')
    const groceries = insights.treemap.find((t: { name: string }) => t.name === 'Groceries')
    expect(groceries.group).toBe('Food')
    expect(groceries.total_cents).toBe(33000)

    expect(insights.merchants[0]).toMatchObject({ name: 'Costco', visits: 2, total_cents: 38000 })

    const sparkGroceries = insights.sparklines.find((s: { name: string }) => s.name === 'Groceries')
    expect(sparkGroceries.months).toHaveLength(6)
    expect(sparkGroceries.months.reduce((a: number, b: number) => a + b, 0)).toBe(33000)
  })
})
