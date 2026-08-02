import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { createLinkedHousehold } from './helpers.js'

let app: FastifyInstance
let cookie: { fold_session: string }
let jakeId: string
let samId: string
let visaId: string

const month = new Date().toISOString().slice(0, 7)
const dayIn = (d: number) => `${month}-${String(d).padStart(2, '0')}`

async function get(url: string): Promise<any> {
  return (await app.inject({ method: 'GET', url, cookies: cookie })).json()
}

async function categoryNamed(name: string): Promise<any> {
  const data = await get('/api/categories')
  return data.categories.find((c: { name: string; scope: string }) => c.name === name && c.scope === 'shared')
}

beforeAll(async () => {
  app = await buildApp({ db: openDb(':memory:'), logger: false })
  const linked = await createLinkedHousehold(app, ['Jake', 'Sam'], 'import.dev')
  cookie = linked.cookie
  jakeId = linked.aId
  samId = linked.bId
  const account = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    cookies: cookie,
    payload: { name: 'Visa', type: 'credit', balance_cents: 50000 },
  })
  visaId = account.json().id
})

afterAll(async () => {
  await app.close()
})

describe('statement import v2', () => {
  it('imports into an account as an undoable batch', async () => {
    const groceries = await categoryNamed('Groceries')
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions/import',
      cookies: cookie,
      payload: {
        payer_user_id: jakeId,
        account_id: visaId,
        filename: 'visa-statement.csv',
        rows: [
          {
            date: dayIn(3),
            description: 'COSTCO WHSE',
            amount_cents: 10000,
            category_id: groceries.id,
            splits: [
              { user_id: jakeId, share_cents: 5000 },
              { user_id: samId, share_cents: 5000 },
            ],
          },
          {
            date: dayIn(4),
            description: 'SHELL OIL',
            amount_cents: 4000,
            splits: [{ user_id: jakeId, share_cents: 4000 }],
          },
        ],
      },
    })
    expect(res.json()).toMatchObject({ imported: 2, skipped: 0 })
    const batchId = res.json().batch_id

    const txs = await get(`/api/transactions?account=${visaId}`)
    expect(txs.transactions).toHaveLength(2)
    expect(txs.transactions.every((t: { account_id: string }) => t.account_id === visaId)).toBe(true)

    const batches = await get('/api/import-batches')
    expect(batches.batches[0]).toMatchObject({
      id: batchId,
      account_name: 'Visa',
      imported_count: 2,
      total_cents: 14000,
    })

    const undo = await app.inject({ method: 'DELETE', url: `/api/import-batches/${batchId}`, cookies: cookie })
    expect(undo.json().deleted).toBe(2)
    const after = await get(`/api/transactions?account=${visaId}`)
    expect(after.transactions).toHaveLength(0)
  })

  it('dedupes by bank transaction id even when the description changes', async () => {
    const payload = (description: string) => ({
      payer_user_id: jakeId,
      account_id: visaId,
      rows: [
        {
          date: dayIn(6),
          description,
          amount_cents: 2500,
          external_id: 'FIT-001',
          splits: [{ user_id: jakeId, share_cents: 2500 }],
        },
      ],
    })
    const first = await app.inject({
      method: 'POST',
      url: '/api/transactions/import',
      cookies: cookie,
      payload: payload('PENDING - COFFEE SHOP'),
    })
    expect(first.json().imported).toBe(1)
    const second = await app.inject({
      method: 'POST',
      url: '/api/transactions/import',
      cookies: cookie,
      payload: payload('COFFEE SHOP #42'),
    })
    expect(second.json()).toMatchObject({ imported: 0, skipped: 1 })
  })

  it('imports credits as refunds that reduce category spending and rebalance the couple', async () => {
    const groceries = await categoryNamed('Groceries')
    const before = await get(`/api/budget/${month}`)
    const beforeSpent = before.categories.find((c: { id: string }) => c.id === groceries.id).spent_cents

    await app.inject({
      method: 'POST',
      url: '/api/transactions/import',
      cookies: cookie,
      payload: {
        payer_user_id: jakeId,
        account_id: visaId,
        rows: [
          {
            date: dayIn(8),
            description: 'COSTCO PURCHASE',
            amount_cents: 8000,
            category_id: groceries.id,
            splits: [
              { user_id: jakeId, share_cents: 4000 },
              { user_id: samId, share_cents: 4000 },
            ],
          },
          {
            date: dayIn(9),
            description: 'COSTCO RETURN',
            amount_cents: -3000,
            category_id: groceries.id,
            splits: [
              { user_id: jakeId, share_cents: -1500 },
              { user_id: samId, share_cents: -1500 },
            ],
          },
        ],
      },
    })

    const after = await get(`/api/budget/${month}`)
    const afterSpent = after.categories.find((c: { id: string }) => c.id === groceries.id).spent_cents
    expect(afterSpent - beforeSpent).toBe(5000)

    // Sam owes half of the net $50, not half of the $80.
    const balances = await get('/api/balances')
    expect(balances.suggestion).toMatchObject({ from_user_id: samId, to_user_id: jakeId, amount_cents: 2500 })
  })

  it('snapshots the account balance from a statement', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/transactions/import',
      cookies: cookie,
      payload: {
        payer_user_id: jakeId,
        account_id: visaId,
        account_balance_cents: -123456,
        balance_date: dayIn(10),
        rows: [
          {
            date: dayIn(10),
            description: 'ONE MORE',
            amount_cents: 1000,
            splits: [{ user_id: jakeId, share_cents: 1000 }],
          },
        ],
      },
    })
    const networth = await get('/api/networth')
    const visa = networth.accounts.find((a: { id: string }) => a.id === visaId)
    expect(visa.balance_cents).toBe(123456)
    expect(visa.balance_date).toBe(dayIn(10))
  })

  it('remembers per-account import profiles', async () => {
    const profile = {
      date_col: 1,
      desc_col: 4,
      amount_col: 2,
      has_header: false,
      negative_is_spending: false,
      payer_user_id: samId,
      default_mode: 'income',
      include_credits: true,
    }
    await app.inject({ method: 'PUT', url: `/api/import-profiles/${visaId}`, cookies: cookie, payload: profile })
    const profiles = await get('/api/import-profiles')
    expect(profiles.profiles[visaId]).toEqual(profile)
  })

  it('filters transactions by text, category, account, and payer', async () => {
    const byText = await get('/api/transactions?q=costco')
    expect(byText.transactions.length).toBeGreaterThanOrEqual(2)
    expect(byText.transactions.every((t: { description: string }) => /costco/i.test(t.description))).toBe(true)

    const groceries = await categoryNamed('Groceries')
    const byCategory = await get(`/api/transactions?category=${groceries.id}`)
    expect(byCategory.transactions.every((t: { lines: { category_id: string | null }[] }) =>
      t.lines.some((l) => l.category_id === groceries.id),
    )).toBe(true)

    const byPayer = await get(`/api/transactions?payer=${samId}`)
    expect(byPayer.transactions.every((t: { payer_user_id: string }) => t.payer_user_id === samId)).toBe(true)
  })

  it('reports member spending shares in trends', async () => {
    const trends = await get('/api/budget-trends?months=2')
    const current = trends.months[trends.months.length - 1]
    expect(current.member_share_cents[jakeId]).toBeGreaterThan(0)
    expect(current.member_share_cents[samId]).toBeGreaterThan(0)
  })
})
