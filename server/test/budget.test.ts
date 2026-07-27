import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { shiftMonth } from '../src/lib/util.js'

let app: FastifyInstance
let cookie: { fold_session: string }
let jakeId: string
let samId: string

const month = new Date().toISOString().slice(0, 7)
const prev = shiftMonth(month, -1)
const twoBack = shiftMonth(month, -2)
const dayIn = (m: string, d: number) => `${m}-${String(d).padStart(2, '0')}`

function sessionCookie(setCookie: string | string[] | undefined): { fold_session: string } {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie
  const match = /fold_session=([^;]+)/.exec(header ?? '')
  if (!match) throw new Error('no session cookie')
  return { fold_session: match[1] }
}

async function get<T = any>(url: string): Promise<T> {
  const res = await app.inject({ method: 'GET', url, cookies: cookie })
  return res.json() as T
}

async function budget(m = month): Promise<any> {
  return get(`/api/budget/${m}`)
}

async function categoryNamed(name: string): Promise<any> {
  const data = await budget()
  return data.categories.find((c: { name: string }) => c.name === name)
}

async function allocate(m: string, categoryId: string, cents: number): Promise<void> {
  await app.inject({
    method: 'PUT',
    url: `/api/budget/${m}/allocations`,
    cookies: cookie,
    payload: { category_id: categoryId, amount_cents: cents },
  })
}

async function spend(date: string, amount: number, categoryId: string | null, description = 'Test'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/transactions',
    cookies: cookie,
    payload: {
      date,
      description,
      amount_cents: amount,
      category_id: categoryId,
      payer_user_id: jakeId,
      splits: [{ user_id: jakeId, share_cents: amount }],
    },
  })
  return res.json().id
}

beforeAll(async () => {
  app = await buildApp({ db: openDb(':memory:'), logger: false })
  const setup = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: {
      household_name: 'Budget House',
      you: { name: 'Jake', email: 'jake@budget.dev', password: 'secret1' },
      partner: { name: 'Sam', email: 'sam@budget.dev', password: 'secret2' },
    },
  })
  cookie = sessionCookie(setup.headers['set-cookie'])
  const me = await get('/api/me')
  jakeId = me.user.id
  samId = me.household.members.find((m: { id: string }) => m.id !== jakeId).id
  await app.inject({
    method: 'POST',
    url: '/api/income',
    cookies: cookie,
    payload: { user_id: jakeId, name: 'Salary', amount_cents: 600000, cadence: 'monthly' },
  })
  await app.inject({
    method: 'POST',
    url: '/api/income',
    cookies: cookie,
    payload: { user_id: samId, name: 'Salary', amount_cents: 400000, cadence: 'monthly' },
  })
})

afterAll(async () => {
  await app.close()
})

describe('category groups', () => {
  it('ships a starter budget grouped into sections', async () => {
    const data = await budget()
    expect(data.groups.length).toBeGreaterThan(3)
    const grouped = data.categories.filter((c: { scope: string; group_id: string | null }) => c.scope === 'shared' && c.group_id)
    expect(grouped.length).toBeGreaterThan(8)
  })
})

describe('rollover', () => {
  it('carries leftover forward when rollover is on, and resets when off', async () => {
    const travel = await categoryNamed('Travel')
    const groceries = await categoryNamed('Groceries')
    expect(travel.rollover).toBe(1)
    expect(groceries.rollover).toBe(0)

    await allocate(twoBack, travel.id, 50000)
    await allocate(prev, travel.id, 50000)
    await allocate(month, travel.id, 50000)
    await allocate(prev, groceries.id, 60000)
    await allocate(month, groceries.id, 60000)
    await spend(dayIn(prev, 5), 20000, groceries.id, 'Groceries last month')

    const data = await budget()
    const travelNow = data.categories.find((c: { id: string }) => c.id === travel.id)
    const groceriesNow = data.categories.find((c: { id: string }) => c.id === groceries.id)

    // Travel: two untouched months roll in.
    expect(travelNow.carryover_cents).toBe(100000)
    expect(travelNow.available_cents).toBe(150000)
    // Groceries: last month's $400 leftover does not follow.
    expect(groceriesNow.carryover_cents).toBe(0)
    expect(groceriesNow.available_cents).toBe(60000)
  })

  it('carries an overspend forward as a negative balance', async () => {
    const repairs = await categoryNamed('Home repairs')
    await allocate(prev, repairs.id, 10000)
    await spend(dayIn(prev, 12), 25000, repairs.id, 'Plumber')
    await allocate(month, repairs.id, 10000)

    const row = (await budget()).categories.find((c: { id: string }) => c.id === repairs.id)
    expect(row.carryover_cents).toBe(-15000)
    expect(row.available_cents).toBe(-5000)
  })
})

describe('targets', () => {
  it('suggests the monthly amount for a monthly target', async () => {
    const gifts = await categoryNamed('Gifts')
    await app.inject({
      method: 'PATCH',
      url: `/api/categories/${gifts.id}`,
      cookies: cookie,
      payload: { target_type: 'monthly', target_cents: 5000 },
    })
    const row = await categoryNamed('Gifts')
    expect(row.target_suggestion_cents).toBe(5000)
  })

  it('spreads a by-date goal over the months remaining', async () => {
    const fund = await categoryNamed('Emergency fund')
    const targetMonth = shiftMonth(month, 3)
    await app.inject({
      method: 'PATCH',
      url: `/api/categories/${fund.id}`,
      cookies: cookie,
      payload: { target_type: 'by_date', target_cents: 400000, target_date: `${targetMonth}-01`, rollover: 1 },
    })
    // Nothing saved yet: $4,000 over this month + 3 more = $1,000 a month.
    let row = await categoryNamed('Emergency fund')
    expect(row.target_suggestion_cents).toBe(100000)

    await allocate(prev, fund.id, 200000)
    row = await categoryNamed('Emergency fund')
    expect(row.carryover_cents).toBe(200000)
    expect(row.target_suggestion_cents).toBe(50000)
  })
})

describe('funding & left to assign', () => {
  it('splits the shared budget by income and reports what is left', async () => {
    const data = await budget()
    const jake = data.members.find((m: { id: string }) => m.id === jakeId)
    const sam = data.members.find((m: { id: string }) => m.id === samId)
    expect(jake.contribution_cents + sam.contribution_cents).toBe(data.shared_allocated_cents)
    expect(jake.contribution_cents).toBe(Math.round(data.shared_allocated_cents * 0.6))
    expect(jake.left_cents).toBe(600000 - jake.contribution_cents - jake.personal_allocated_cents)
    expect(data.unassigned_cents).toBe(data.combined_income_cents - data.total_assigned_cents)
  })

  it('honours a per-month income override', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/budget/${month}/income`,
      cookies: cookie,
      payload: { user_id: jakeId, amount_cents: 900000 },
    })
    let jake = (await budget()).members.find((m: { id: string }) => m.id === jakeId)
    expect(jake.monthly_income_cents).toBe(900000)
    expect(jake.income_override_cents).toBe(900000)

    await app.inject({
      method: 'PUT',
      url: `/api/budget/${month}/income`,
      cookies: cookie,
      payload: { user_id: jakeId, amount_cents: null },
    })
    jake = (await budget()).members.find((m: { id: string }) => m.id === jakeId)
    expect(jake.monthly_income_cents).toBe(600000)
    expect(jake.income_override_cents).toBeNull()
  })
})

describe('move money', () => {
  it('shifts budgeted money between envelopes without touching spending', async () => {
    const dining = await categoryNamed('Dining out')
    const groceries = await categoryNamed('Groceries')
    await allocate(month, dining.id, 30000)
    const before = await budget()
    const spentBefore = before.total_spent_cents

    await app.inject({
      method: 'POST',
      url: `/api/budget/${month}/move`,
      cookies: cookie,
      payload: { from_category_id: dining.id, to_category_id: groceries.id, amount_cents: 5000 },
    })

    const after = await budget()
    expect(after.categories.find((c: { id: string }) => c.id === dining.id).allocated_cents).toBe(25000)
    expect(after.categories.find((c: { id: string }) => c.id === groceries.id).allocated_cents).toBe(65000)
    expect(after.total_spent_cents).toBe(spentBefore)
    expect(after.total_assigned_cents).toBe(before.total_assigned_cents)
  })

  it('refuses to move more than an envelope holds', async () => {
    const dining = await categoryNamed('Dining out')
    const groceries = await categoryNamed('Groceries')
    const res = await app.inject({
      method: 'POST',
      url: `/api/budget/${month}/move`,
      cookies: cookie,
      payload: { from_category_id: dining.id, to_category_id: groceries.id, amount_cents: 9_000_000 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('quick fill', () => {
  it('copies last month into an empty month', async () => {
    const next = shiftMonth(month, 1)
    const result = await app.inject({
      method: 'POST',
      url: `/api/budget/${next}/quick-fill`,
      cookies: cookie,
      payload: { strategy: 'last_month' },
    })
    expect(result.json().filled).toBeGreaterThan(0)
    const nextBudget = await budget(next)
    const thisBudget = await budget()
    expect(nextBudget.shared_allocated_cents).toBe(thisBudget.shared_allocated_cents)
  })
})

describe('multi-category transactions', () => {
  it('books each line against its own category', async () => {
    const groceries = await categoryNamed('Groceries')
    const household = await categoryNamed('Household')
    await allocate(month, household.id, 20000)
    const before = await budget()

    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      cookies: cookie,
      payload: {
        date: dayIn(month, 10),
        description: 'Costco run',
        amount_cents: 30000,
        payer_user_id: jakeId,
        splits: [
          { user_id: jakeId, share_cents: 15000 },
          { user_id: samId, share_cents: 15000 },
        ],
        lines: [
          { category_id: groceries.id, amount_cents: 10000 },
          { category_id: household.id, amount_cents: 20000 },
        ],
      },
    })
    expect(res.statusCode).toBe(200)

    const after = await budget()
    const groceriesRow = after.categories.find((c: { id: string }) => c.id === groceries.id)
    const householdRow = after.categories.find((c: { id: string }) => c.id === household.id)
    const groceriesBefore = before.categories.find((c: { id: string }) => c.id === groceries.id)
    expect(groceriesRow.spent_cents - groceriesBefore.spent_cents).toBe(10000)
    expect(householdRow.spent_cents).toBe(20000)
    expect(after.total_spent_cents - before.total_spent_cents).toBe(30000)
  })

  it('rejects lines that do not add up to the total', async () => {
    const groceries = await categoryNamed('Groceries')
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      cookies: cookie,
      payload: {
        date: dayIn(month, 11),
        description: 'Bad lines',
        amount_cents: 10000,
        payer_user_id: jakeId,
        splits: [{ user_id: jakeId, share_cents: 10000 }],
        lines: [{ category_id: groceries.id, amount_cents: 4000 }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('counts unfiled transactions and clears them through the classify endpoint', async () => {
    const txId = await spend(dayIn(month, 14), 7500, null, 'AMZN MKTP')
    let data = await budget()
    expect(data.uncategorized.count).toBeGreaterThan(0)
    expect(data.uncategorized.amount_cents).toBeGreaterThanOrEqual(7500)

    const queue = await get('/api/transactions?uncategorized=1')
    expect(queue.transactions.some((t: { id: string }) => t.id === txId)).toBe(true)

    const groceries = await categoryNamed('Groceries')
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/transactions/${txId}/categories`,
      cookies: cookie,
      payload: { lines: [{ category_id: groceries.id, amount_cents: 7500 }] },
    })
    expect(res.statusCode).toBe(200)

    data = await budget()
    expect(data.uncategorized.count).toBe(0)
    const after = await get('/api/transactions?uncategorized=1')
    expect(after.transactions).toHaveLength(0)
  })
})

describe('category detail & trends', () => {
  it('returns six months of history and this month’s transactions', async () => {
    const groceries = await categoryNamed('Groceries')
    const detail = await get(`/api/budget/${month}/categories/${groceries.id}`)
    expect(detail.history).toHaveLength(6)
    expect(detail.history[detail.history.length - 1].month).toBe(month)
    expect(detail.transactions.every((t: { lines: { category_id: string | null }[] }) =>
      t.lines.some((l) => l.category_id === groceries.id),
    )).toBe(true)
  })

  it('summarizes spending by month and group', async () => {
    const trends = await get('/api/budget-trends?months=4')
    expect(trends.months).toHaveLength(4)
    expect(trends.months[trends.months.length - 1].month).toBe(month)
    expect(trends.by_group.length).toBeGreaterThan(0)
  })
})
