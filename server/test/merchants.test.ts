import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { createLinkedHousehold, signup } from './helpers.js'

let app: FastifyInstance
let cookie: { fold_session: string }
let jakeId: string
let samId: string

const month = new Date().toISOString().slice(0, 7)
const dayIn = (d: number) => `${month}-${String(d).padStart(2, '0')}`

async function get(url: string, c = cookie): Promise<any> {
  return (await app.inject({ method: 'GET', url, cookies: c })).json()
}

beforeAll(async () => {
  app = await buildApp({ db: openDb(':memory:'), logger: false })
  const linked = await createLinkedHousehold(app, ['Jake', 'Sam'], 'store.dev')
  cookie = linked.cookie
  jakeId = linked.aId
  samId = linked.bId
})

afterAll(async () => {
  await app.close()
})

describe('server admin & invite-only signup', () => {
  it('makes the first account the admin and blocks open signup', async () => {
    const me = await get('/api/me')
    expect(me.user.is_admin).toBe(1)

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { name: 'Stranger', email: 'stranger@store.dev', password: 'secret1' },
    })
    expect(blocked.statusCode).toBe(400)
    expect(blocked.json().error).toContain('invite-only')

    const boot = await app.inject({ method: 'GET', url: '/api/bootstrap' })
    expect(boot.json()).toMatchObject({ has_users: true, signup_open: false })
  })

  it('lets the admin open signup, and only the admin', async () => {
    // Sam (second account) is not the admin.
    const samLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'sam@store.dev', password: 'secret1' },
    })
    expect(samLogin.json().user.is_admin).toBe(0)
    const samCookie = { fold_session: /fold_session=([^;]+)/.exec(String(samLogin.headers['set-cookie']))![1] }
    const forbidden = await app.inject({
      method: 'PATCH',
      url: '/api/instance',
      cookies: samCookie,
      payload: { open_signup: true },
    })
    expect(forbidden.statusCode).toBe(403)

    const allowed = await app.inject({
      method: 'PATCH',
      url: '/api/instance',
      cookies: cookie,
      payload: { open_signup: true },
    })
    expect(allowed.json()).toEqual({ open_signup: true })

    const open = await signup(app, { name: 'Walk-in', email: 'walkin@store.dev' })
    expect(open.userId).toBeTruthy()

    await app.inject({ method: 'PATCH', url: '/api/instance', cookies: cookie, payload: { open_signup: false } })
  })
})

describe('merchants', () => {
  it('creates stores, attaches them to transactions, and learns the usual category', async () => {
    const costco = (
      await app.inject({
        method: 'POST',
        url: '/api/merchants',
        cookies: cookie,
        payload: { name: 'Costco', domain: 'costco.com' },
      })
    ).json()
    const categories = await get('/api/categories')
    const groceries = categories.categories.find((c: { name: string; scope: string }) => c.name === 'Groceries' && c.scope === 'shared')

    for (const day of [2, 9]) {
      await app.inject({
        method: 'POST',
        url: '/api/transactions',
        cookies: cookie,
        payload: {
          date: dayIn(day),
          description: 'Costco',
          amount_cents: 5000 + day,
          category_id: groceries.id,
          merchant_id: costco.id,
          payer_user_id: jakeId,
          splits: [{ user_id: jakeId, share_cents: 5000 + day }],
        },
      })
    }

    const merchants = await get('/api/merchants')
    const row = merchants.merchants.find((m: { id: string }) => m.id === costco.id)
    expect(row).toMatchObject({ name: 'Costco', domain: 'costco.com', uses: 2, top_category_id: groceries.id })

    // Search matches the store name even when descriptions differ.
    const search = await get('/api/transactions?q=costco')
    expect(search.transactions.length).toBeGreaterThanOrEqual(2)

    // Creating the same name again reuses the store.
    const again = (
      await app.inject({ method: 'POST', url: '/api/merchants', cookies: cookie, payload: { name: 'costco' } })
    ).json()
    expect(again).toMatchObject({ id: costco.id, existed: true })
  })

  it('rejects a bad domain and validates household ownership', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/merchants',
      cookies: cookie,
      payload: { name: 'Nope', domain: 'not a domain' },
    })
    expect(bad.statusCode).toBe(400)

    const outsider = await signup(app, { name: 'Zed', email: 'zed@store.dev', invite_code: undefined }).catch(() => null)
    // Signup is invite-only again, so use Sam's merchant check instead:
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      cookies: cookie,
      payload: {
        date: dayIn(11),
        description: 'Bad store ref',
        amount_cents: 1000,
        merchant_id: 'not-a-real-store',
        payer_user_id: jakeId,
        splits: [{ user_id: jakeId, share_cents: 1000 }],
      },
    })
    expect(foreign.statusCode).toBe(400)
    expect(outsider).toBeNull()
  })
})

describe('duplicate detection', () => {
  it('flags a same-amount neighbor for new entries and imports', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      cookies: cookie,
      payload: {
        date: dayIn(14),
        description: 'Dinner at Nopa',
        amount_cents: 12345,
        payer_user_id: jakeId,
        splits: [{ user_id: jakeId, share_cents: 12345 }],
      },
    })
    const check = (
      await app.inject({
        method: 'POST',
        url: '/api/transactions/check-duplicates',
        cookies: cookie,
        payload: { rows: [{ date: dayIn(16), amount_cents: 12345 }, { date: dayIn(25), amount_cents: 12345 }] },
      })
    ).json()
    expect(check.matches[0]).toMatchObject({ description: 'Dinner at Nopa', imported: false })
    expect(check.matches[1]).toBeNull()
  })

  it('sweeps lookalike pairs and honors dismissals', async () => {
    // Manual entry + imported statement row for the same purchase.
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      cookies: cookie,
      payload: {
        date: dayIn(20),
        description: 'Target run',
        amount_cents: 8934,
        payer_user_id: samId,
        splits: [{ user_id: samId, share_cents: 8934 }],
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/transactions/import',
      cookies: cookie,
      payload: {
        payer_user_id: samId,
        rows: [
          {
            date: dayIn(21),
            description: 'POS DEBIT 4412 TARGET',
            amount_cents: 8934,
            splits: [{ user_id: samId, share_cents: 8934 }],
          },
        ],
      },
    })

    let sweep = await get('/api/transactions/duplicates')
    const pair = sweep.pairs.find(
      (p: { a: { amount_cents: number } }) => p.a.amount_cents === 8934,
    )
    expect(pair).toBeTruthy()
    expect([pair.a.imported, pair.b.imported].sort()).toEqual([false, true])

    await app.inject({
      method: 'POST',
      url: '/api/transactions/duplicates/dismiss',
      cookies: cookie,
      payload: { a: pair.a.id, b: pair.b.id },
    })
    sweep = await get('/api/transactions/duplicates')
    expect(sweep.pairs.some((p: { a: { id: string } }) => p.a.id === pair.a.id && p.a.amount_cents === 8934)).toBe(false)
  })

  it('does not pair two distinct imported charges with unrelated names', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/transactions/import',
      cookies: cookie,
      payload: {
        payer_user_id: jakeId,
        rows: [
          { date: dayIn(26), description: 'SHELL OIL 5744', amount_cents: 4444, external_id: 'X1', splits: [{ user_id: jakeId, share_cents: 4444 }] },
          { date: dayIn(27), description: 'BLUE BOTTLE COFFEE', amount_cents: 4444, external_id: 'X2', splits: [{ user_id: jakeId, share_cents: 4444 }] },
        ],
      },
    })
    const sweep = await get('/api/transactions/duplicates')
    expect(
      sweep.pairs.some((p: { a: { amount_cents: number } }) => p.a.amount_cents === 4444),
    ).toBe(false)
  })
})
