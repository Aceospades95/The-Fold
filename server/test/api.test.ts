import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { materializeRecurring } from '../src/lib/recurring.js'
import { createLinkedHousehold } from './helpers.js'

let app: FastifyInstance
let cookie: { fold_session: string }
let jakeId: string
let samId: string

beforeAll(async () => {
  app = await buildApp({ db: openDb(':memory:'), logger: false })
  const linked = await createLinkedHousehold(app)
  cookie = linked.cookie
  jakeId = linked.aId
  samId = linked.bId
})

afterAll(async () => {
  await app.close()
})

const month = new Date().toISOString().slice(0, 7)
const today = new Date().toISOString().slice(0, 10)

describe('auth', () => {
  it('rejects requests without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/summary' })
    expect(res.statusCode).toBe(401)
  })

  it('refuses a duplicate email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { name: 'Copycat', email: 'jake@test.dev', password: 'secret1' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('budget funding', () => {
  it('computes income-proportional contributions that sum to the shared budget', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: cookie,
      payload: { user_id: jakeId, name: 'Salary', amount_cents: 300000, cadence: 'monthly' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: cookie,
      payload: { user_id: samId, name: 'Salary', amount_cents: 100000, cadence: 'monthly' },
    })
    const budget = await app.inject({ method: 'GET', url: `/api/budget/${month}`, cookies: cookie })
    const categories = budget.json().categories.filter((c: { scope: string }) => c.scope === 'shared')
    await app.inject({
      method: 'PUT',
      url: `/api/budget/${month}/allocations`,
      cookies: cookie,
      payload: { category_id: categories[0].id, amount_cents: 100000 },
    })
    const after = (await app.inject({ method: 'GET', url: `/api/budget/${month}`, cookies: cookie })).json()
    const jake = after.members.find((m: { id: string }) => m.id === jakeId)
    const sam = after.members.find((m: { id: string }) => m.id === samId)
    expect(jake.contribution_cents).toBe(75000)
    expect(sam.contribution_cents).toBe(25000)
    expect(jake.contribution_cents + sam.contribution_cents).toBe(after.shared_allocated_cents)
  })
})

describe('transactions & balances', () => {
  it('rejects splits that do not sum to the amount', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      cookies: cookie,
      payload: {
        date: today,
        description: 'Bad split',
        amount_cents: 1000,
        payer_user_id: jakeId,
        splits: [{ user_id: jakeId, share_cents: 400 }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('tracks who owes whom and settles to zero', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      cookies: cookie,
      payload: {
        date: today,
        description: 'Dinner',
        amount_cents: 10000,
        payer_user_id: jakeId,
        splits: [
          { user_id: jakeId, share_cents: 5000 },
          { user_id: samId, share_cents: 5000 },
        ],
      },
    })
    let balances = (await app.inject({ method: 'GET', url: '/api/balances', cookies: cookie })).json()
    expect(balances.suggestion).toEqual({ from_user_id: samId, to_user_id: jakeId, amount_cents: 5000 })

    await app.inject({
      method: 'POST',
      url: '/api/settle',
      cookies: cookie,
      payload: { from_user_id: samId, to_user_id: jakeId, amount_cents: 5000, date: today },
    })
    balances = (await app.inject({ method: 'GET', url: '/api/balances', cookies: cookie })).json()
    expect(balances.suggestion).toBeNull()
    const total = balances.balances.reduce((sum: number, b: { net_cents: number }) => sum + b.net_cents, 0)
    expect(total).toBe(0)
  })
})

describe('trips', () => {
  it('posts a trip expense into the budget exactly once', async () => {
    const trip = (
      await app.inject({
        method: 'POST',
        url: '/api/trips',
        cookies: cookie,
        payload: { name: 'Test Trip', status: 'planned' },
      })
    ).json()
    const detail = (await app.inject({ method: 'GET', url: `/api/trips/${trip.id}`, cookies: cookie })).json()
    const expense = (
      await app.inject({
        method: 'POST',
        url: `/api/trips/${trip.id}/expenses`,
        cookies: cookie,
        payload: { name: 'Hotel', trip_category_id: detail.categories[0].id, planned_cents: 20000, actual_cents: 18000 },
      })
    ).json()

    const categories = (await app.inject({ method: 'GET', url: '/api/categories', cookies: cookie })).json()
    const shared = categories.categories.find((c: { scope: string }) => c.scope === 'shared')
    const post = await app.inject({
      method: 'POST',
      url: `/api/trip-expenses/${expense.id}/post`,
      cookies: cookie,
      payload: {
        category_id: shared.id,
        payer_user_id: jakeId,
        splits: [
          { user_id: jakeId, share_cents: 9000 },
          { user_id: samId, share_cents: 9000 },
        ],
      },
    })
    expect(post.statusCode).toBe(200)

    const again = await app.inject({
      method: 'POST',
      url: `/api/trip-expenses/${expense.id}/post`,
      cookies: cookie,
      payload: { category_id: shared.id, payer_user_id: jakeId, splits: [{ user_id: jakeId, share_cents: 18000 }] },
    })
    expect(again.statusCode).toBe(400)

    const txs = (await app.inject({ method: 'GET', url: `/api/transactions?month=${month}`, cookies: cookie })).json()
    const posted = txs.transactions.filter((t: { description: string }) => t.description.includes('Hotel'))
    expect(posted).toHaveLength(1)
  })
})

describe('recurring', () => {
  it('materializes due occurrences immediately and advances next_date', async () => {
    const day = new Date().getUTCDate()
    const create = await app.inject({
      method: 'POST',
      url: '/api/recurring',
      cookies: cookie,
      payload: {
        description: 'Rent',
        amount_cents: 200000,
        payer_user_id: jakeId,
        splits: [
          { user_id: jakeId, share_cents: 100000 },
          { user_id: samId, share_cents: 100000 },
        ],
        cadence: 'monthly',
        day_of_month: Math.min(day, 28),
      },
    })
    expect(create.statusCode).toBe(200)
    if (day <= 28) expect(create.json().posted_now).toBe(1)

    const txs = (await app.inject({ method: 'GET', url: `/api/transactions?month=${month}`, cookies: cookie })).json()
    const rent = txs.transactions.filter((t: { description: string }) => t.description === 'Rent')
    if (day <= 28) {
      expect(rent).toHaveLength(1)
      expect(rent[0].recurring_id).toBeTruthy()
    }

    // Idempotent: a second run creates nothing new.
    expect(materializeRecurring(app.db)).toBe(0)
  })
})

describe('csv import', () => {
  it('imports rows once and skips duplicates on re-import', async () => {
    const payload = {
      payer_user_id: jakeId,
      rows: [
        {
          date: today,
          description: 'COSTCO WHSE #482',
          amount_cents: 15499,
          category_id: null,
          splits: [
            { user_id: jakeId, share_cents: 7750 },
            { user_id: samId, share_cents: 7749 },
          ],
        },
      ],
    }
    const first = (await app.inject({ method: 'POST', url: '/api/transactions/import', cookies: cookie, payload })).json()
    expect(first).toEqual({ imported: 1, skipped: 0 })
    const second = (await app.inject({ method: 'POST', url: '/api/transactions/import', cookies: cookie, payload })).json()
    expect(second).toEqual({ imported: 0, skipped: 1 })
  })
})

describe('net worth', () => {
  it('nets assets against liabilities', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: cookie,
      payload: { name: 'Checking', type: 'checking', balance_cents: 500000 },
    })
    await app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: cookie,
      payload: { name: 'Visa', type: 'credit', balance_cents: 120000 },
    })
    const networth = (await app.inject({ method: 'GET', url: '/api/networth', cookies: cookie })).json()
    expect(networth.assets_cents).toBe(500000)
    expect(networth.liabilities_cents).toBe(120000)
    expect(networth.net_cents).toBe(380000)
  })
})

describe('token hooks', () => {
  it('lets a bearer token add and complete list items, and rejects bad tokens', async () => {
    const token = (
      await app.inject({ method: 'POST', url: '/api/integrations/tokens', cookies: cookie, payload: { name: 'HA' } })
    ).json().token

    const add = await app.inject({
      method: 'POST',
      url: '/api/hooks/list-items',
      headers: { authorization: `Bearer ${token}` },
      payload: { list: 'Groceries', text: 'Oat milk' },
    })
    expect(add.statusCode).toBe(200)

    const complete = await app.inject({
      method: 'POST',
      url: '/api/hooks/complete-item',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'oat milk' },
    })
    expect(complete.statusCode).toBe(200)
    expect(complete.json().done).toBe(true)

    const bad = await app.inject({
      method: 'GET',
      url: '/api/hooks/summary',
      headers: { authorization: 'Bearer nope' },
    })
    expect(bad.statusCode).toBe(401)
  })
})

describe('calendar feed', () => {
  it('serves an ICS feed with planned trips', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      cookies: cookie,
      payload: { name: 'ICS Trip', status: 'planned', start_date: '2027-01-10', end_date: '2027-01-12' },
    })
    const me = (await app.inject({ method: 'GET', url: '/api/me', cookies: cookie })).json()
    const feed = await app.inject({ method: 'GET', url: me.household.calendar_path })
    expect(feed.statusCode).toBe(200)
    expect(feed.headers['content-type']).toContain('text/calendar')
    expect(feed.body).toContain('BEGIN:VCALENDAR')
    expect(feed.body).toContain('ICS Trip')
    expect(feed.body).toContain('DTSTART;VALUE=DATE:20270110')
  })
})
