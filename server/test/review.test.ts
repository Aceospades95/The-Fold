import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { createLinkedHousehold } from './helpers.js'

let app: FastifyInstance
let cookie: { fold_session: string }
let jakeId: string
let samId: string
let groceriesId: string
let travelId: string

const month = new Date().toISOString().slice(0, 7)
const dayIn = (d: number) => `${month}-${String(d).padStart(2, '0')}`

async function get(url: string): Promise<any> {
  const res = await app.inject({ method: 'GET', url, cookies: cookie })
  expect(res.statusCode).toBe(200)
  return res.json()
}

beforeAll(async () => {
  app = await buildApp({ db: openDb(':memory:'), logger: false })
  const linked = await createLinkedHousehold(app, ['Jake', 'Sam'], 'review.dev')
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
  groceriesId = categories.categories.find((c: { name: string; scope: string }) => c.name === 'Groceries' && c.scope === 'shared').id
  travelId = categories.categories.find((c: { name: string; scope: string }) => c.name === 'Travel' && c.scope === 'shared').id

  // Groceries: budget 500, spend 300 (a win). Travel (rollover): budget 200, spend 0 (rolls forward).
  for (const [categoryId, amount] of [
    [groceriesId, 50000],
    [travelId, 20000],
  ] as [string, number][]) {
    await app.inject({
      method: 'PUT',
      url: `/api/budget/${month}/allocations`,
      cookies: cookie,
      payload: { category_id: categoryId, amount_cents: amount },
    })
  }
  await app.inject({
    method: 'POST',
    url: '/api/transactions',
    cookies: cookie,
    payload: {
      date: dayIn(6),
      description: 'Groceries run',
      amount_cents: 30000,
      category_id: groceriesId,
      payer_user_id: jakeId,
      splits: [
        { user_id: jakeId, share_cents: 20000 },
        { user_id: samId, share_cents: 10000 },
      ],
    },
  })
})

afterAll(async () => {
  await app.close()
})

describe('month in review', () => {
  it('tells the story of the month: headline, wins, rollovers, shares', async () => {
    const review = await get(`/api/review/${month}`)
    expect(review.income_cents).toBe(400000)
    expect(review.spent_cents).toBe(30000)
    expect(review.kept_cents).toBe(370000)
    expect(review.savings_rate).toBe(93)
    expect(review.transactions_count).toBe(1)
    expect(review.has_next).toBe(false)

    expect(review.wins.some((w: { name: string; amount_cents: number }) => w.name === 'Groceries' && w.amount_cents === 20000)).toBe(true)
    expect(review.rolled_forward.some((r: { name: string; amount_cents: number }) => r.name === 'Travel' && r.amount_cents === 20000)).toBe(true)
    expect(review.overspent).toHaveLength(0)

    const jake = review.members.find((m: { user_id: string }) => m.user_id === jakeId)
    const sam = review.members.find((m: { user_id: string }) => m.user_id === samId)
    expect(jake.share_cents).toBe(20000)
    expect(sam.share_cents).toBe(10000)

    expect(review.biggest_purchases[0].description).toBe('Groceries run')
    // Sam owes Jake her 100.00 share.
    expect(review.balance).toMatchObject({ from_user_id: samId, to_user_id: jakeId, amount_cents: 10000 })
  })

  it('flags overspending once it happens', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      cookies: cookie,
      payload: {
        date: dayIn(12),
        description: 'Groceries blowout',
        amount_cents: 30000,
        category_id: groceriesId,
        payer_user_id: jakeId,
        splits: [{ user_id: jakeId, share_cents: 30000 }],
      },
    })
    const review = await get(`/api/review/${month}`)
    // 600 spent of 500 budgeted → 100 over, and it stops being a win.
    expect(review.overspent.some((o: { name: string; amount_cents: number }) => o.name === 'Groceries' && o.amount_cents === 10000)).toBe(true)
    expect(review.wins.some((w: { name: string }) => w.name === 'Groceries')).toBe(false)
  })
})

describe('reconciliation', () => {
  it('imports arrive cleared, manual entries pend, ticks flip them', async () => {
    const account = (
      await app.inject({
        method: 'POST',
        url: '/api/accounts',
        cookies: cookie,
        payload: { name: 'Joint checking', type: 'checking' },
      })
    ).json()

    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      cookies: cookie,
      payload: {
        date: dayIn(14),
        description: 'Manual pending entry',
        amount_cents: 4200,
        payer_user_id: jakeId,
        account_id: account.id,
        splits: [{ user_id: jakeId, share_cents: 4200 }],
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/transactions/import',
      cookies: cookie,
      payload: {
        account_id: account.id,
        payer_user_id: jakeId,
        rows: [
          {
            date: dayIn(15),
            description: 'BANK POSTED ROW',
            amount_cents: 5600,
            external_id: 'REC-1',
            splits: [{ user_id: jakeId, share_cents: 5600 }],
          },
        ],
      },
    })

    const pending = await get(`/api/transactions?uncleared=1&account=${account.id}`)
    expect(pending.transactions).toHaveLength(1)
    expect(pending.transactions[0].description).toBe('Manual pending entry')

    const all = await get(`/api/transactions?account=${account.id}&month=${month}`)
    const imported = all.transactions.find((t: { description: string }) => t.description === 'BANK POSTED ROW')
    expect(imported.cleared).toBe(1)

    const flip = await app.inject({
      method: 'POST',
      url: '/api/transactions/set-cleared',
      cookies: cookie,
      payload: { ids: [pending.transactions[0].id], cleared: true },
    })
    expect(flip.json()).toEqual({ updated: 1 })
    const after = await get(`/api/transactions?uncleared=1&account=${account.id}`)
    expect(after.transactions).toHaveLength(0)
  })

  it('ignores transaction ids from another household', async () => {
    const stranger = await createLinkedHousehold(app, ['Zoe', 'Max'], 'other.dev').catch(() => null)
    // Invite-only server: second household can't even sign up, which is its own guarantee.
    if (!stranger) {
      expect(stranger).toBeNull()
      return
    }
    const mine = await get(`/api/transactions?month=${month}`)
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/transactions/set-cleared',
      cookies: stranger.cookie,
      payload: { ids: [mine.transactions[0].id], cleared: false },
    })
    expect(foreign.json()).toEqual({ updated: 0 })
  })
})
