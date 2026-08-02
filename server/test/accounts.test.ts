import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { createLinkedHousehold, signup } from './helpers.js'

let app: FastifyInstance

const month = new Date().toISOString().slice(0, 7)

beforeEach(async () => {
  app = await buildApp({ db: openDb(':memory:'), logger: false })
})

afterEach(async () => {
  await app.close()
})

async function get(cookie: { fold_session: string }, url: string): Promise<any> {
  return (await app.inject({ method: 'GET', url, cookies: cookie })).json()
}

describe('solo signup', () => {
  it('creates a full starter budget for one person', async () => {
    const a = await signup(app, { name: 'Ada Lovelace', email: 'ada@solo.dev' })
    const me = await get(a.cookie, '/api/me')
    expect(me.household.members).toHaveLength(1)
    expect(me.household.name).toContain('Ada')
    const categories = await get(a.cookie, '/api/categories')
    expect(categories.groups.length).toBeGreaterThan(3)
    expect(categories.categories.some((c: { scope: string }) => c.scope === 'personal')).toBe(true)
  })
})

describe('invite linking', () => {
  it('signs a partner up straight into the household with a code', async () => {
    const { cookie, cookieB, aId, bId } = await createLinkedHousehold(app)
    const meA = await get(cookie, '/api/me')
    const meB = await get(cookieB, '/api/me')
    expect(meA.household.id).toBe(meB.household.id)
    expect(meA.household.members).toHaveLength(2)
    // Distinct avatar colors.
    const colors = meA.household.members.map((m: { color: string }) => m.color)
    expect(new Set(colors).size).toBe(2)
    // The joiner got personal envelopes of their own.
    const categories = await get(cookieB, '/api/categories')
    const bPersonal = categories.categories.filter(
      (c: { scope: string; owner_user_id: string }) => c.scope === 'personal' && c.owner_user_id === bId,
    )
    expect(bPersonal.length).toBeGreaterThan(0)
    const aPersonal = categories.categories.filter(
      (c: { scope: string; owner_user_id: string }) => c.scope === 'personal' && c.owner_user_id === aId,
    )
    expect(aPersonal.length).toBeGreaterThan(0)
  })

  it('merges a solo budget through redeem: activity becomes personal, junk is dropped', async () => {
    const a = await signup(app, { name: 'Jake', email: 'jake@merge.dev' })
    // Second solo account needs open signup (the first account is the admin).
    await app.inject({ method: 'PATCH', url: '/api/instance', cookies: a.cookie, payload: { open_signup: true } })
    const b = await signup(app, { name: 'Sam', email: 'sam@merge.dev' })

    // Sam uses her solo budget: spends in Groceries, budgets Travel.
    const bCategories = await get(b.cookie, '/api/categories')
    const groceries = bCategories.categories.find((c: { name: string }) => c.name === 'Groceries')
    const travel = bCategories.categories.find((c: { name: string }) => c.name === 'Travel')
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      cookies: b.cookie,
      payload: {
        date: `${month}-05`,
        description: 'Solo groceries',
        amount_cents: 4200,
        category_id: groceries.id,
        payer_user_id: b.userId,
        splits: [{ user_id: b.userId, share_cents: 4200 }],
      },
    })
    await app.inject({
      method: 'PUT',
      url: `/api/budget/${month}/allocations`,
      cookies: b.cookie,
      payload: { category_id: travel.id, amount_cents: 30000 },
    })

    const invite = (await app.inject({ method: 'POST', url: '/api/invites', cookies: a.cookie })).json()
    const redeem = await app.inject({
      method: 'POST',
      url: '/api/invites/redeem',
      cookies: b.cookie,
      payload: { code: invite.code },
    })
    expect(redeem.statusCode).toBe(200)

    const meA = await get(a.cookie, '/api/me')
    expect(meA.household.members).toHaveLength(2)

    const budget = await get(a.cookie, `/api/budget/${month}`)
    const samPersonal = budget.categories.filter(
      (c: { scope: string; owner_user_id: string | null }) => c.scope === 'personal' && c.owner_user_id === b.userId,
    )
    // Groceries (spent) and Travel (allocated) survived as Sam's personal envelopes.
    expect(samPersonal.some((c: { name: string; spent_cents: number }) => c.name === 'Groceries' && c.spent_cents === 4200)).toBe(true)
    expect(samPersonal.some((c: { name: string; allocated_cents: number }) => c.name === 'Travel' && c.allocated_cents === 30000)).toBe(true)
    // Untouched solo defaults were not duplicated in: exactly one shared Groceries.
    const sharedGroceries = budget.categories.filter(
      (c: { scope: string; name: string }) => c.scope === 'shared' && c.name === 'Groceries',
    )
    expect(sharedGroceries).toHaveLength(1)
    // The balance follows: Sam paid 4200 for herself, so nobody owes anybody.
    const balances = await get(a.cookie, '/api/balances')
    expect(balances.suggestion).toBeNull()
  })

  it('rejects bad, reused, and non-solo redemptions', async () => {
    const a = await signup(app, { name: 'Jake', email: 'jake@guard.dev' })
    await app.inject({ method: 'PATCH', url: '/api/instance', cookies: a.cookie, payload: { open_signup: true } })
    const invite = (await app.inject({ method: 'POST', url: '/api/invites', cookies: a.cookie })).json()

    const bogus = await app.inject({
      method: 'POST',
      url: '/api/invites/redeem',
      cookies: a.cookie,
      payload: { code: 'NOPE-NOPE' },
    })
    expect(bogus.statusCode).toBe(400)

    // Sam joins by signup-with-code; the code is now used.
    await signup(app, { name: 'Sam', email: 'sam@guard.dev', invite_code: invite.code })
    const again = await signup(app, { name: 'Eve', email: 'eve@guard.dev' })
    const reused = await app.inject({
      method: 'POST',
      url: '/api/invites/redeem',
      cookies: again.cookie,
      payload: { code: invite.code },
    })
    expect(reused.statusCode).toBe(400)
    expect(reused.json().error).toContain('already used')

    // A two-person household cannot redeem into a third.
    const other = await signup(app, { name: 'Zoe', email: 'zoe@guard.dev' })
    const otherInvite = (await app.inject({ method: 'POST', url: '/api/invites', cookies: other.cookie })).json()
    const fromLinked = await app.inject({
      method: 'POST',
      url: '/api/invites/redeem',
      cookies: a.cookie,
      payload: { code: otherInvite.code },
    })
    expect(fromLinked.statusCode).toBe(400)
    expect(fromLinked.json().error).toContain('solo')
  })
})

describe('paycheck breakdown & split basis', () => {
  it('derives net from gross minus deductions and rejects impossible ones', async () => {
    const { cookie, aId } = await createLinkedHousehold(app, ['Jake', 'Sam'], 'pay.dev')
    const created = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: cookie,
      payload: {
        user_id: aId,
        name: 'Salary',
        amount_cents: 0,
        gross_cents: 500000,
        deductions: [
          { name: 'Fed', amount_cents: 90000, kind: 'tax' },
          { name: '401k', amount_cents: 50000, kind: 'pretax' },
        ],
        cadence: 'monthly',
      },
    })
    expect(created.statusCode).toBe(200)
    const sources = (await get(cookie, '/api/income')).sources
    expect(sources[0].amount_cents).toBe(360000)
    expect(sources[0].gross_cents).toBe(500000)

    const impossible = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: cookie,
      payload: {
        user_id: aId,
        name: 'Broken',
        amount_cents: 0,
        gross_cents: 1000,
        deductions: [{ name: 'Too big', amount_cents: 2000, kind: 'tax' }],
        cadence: 'monthly',
      },
    })
    expect(impossible.statusCode).toBe(400)
  })

  it('splits proportionally on net vs gross depending on the basis', async () => {
    const { cookie, aId, bId } = await createLinkedHousehold(app, ['Jake', 'Sam'], 'basis.dev')
    // Jake: gross 6000, net 4000. Sam: gross 4000, net 4000 (no breakdown).
    await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: cookie,
      payload: {
        user_id: aId,
        name: 'Salary',
        amount_cents: 0,
        gross_cents: 600000,
        deductions: [{ name: 'Tax', amount_cents: 200000, kind: 'tax' }],
        cadence: 'monthly',
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: cookie,
      payload: { user_id: bId, name: 'Salary', amount_cents: 400000, cadence: 'monthly' },
    })
    const categories = await get(cookie, '/api/categories')
    const shared = categories.categories.find((c: { scope: string }) => c.scope === 'shared')
    await app.inject({
      method: 'PUT',
      url: `/api/budget/${month}/allocations`,
      cookies: cookie,
      payload: { category_id: shared.id, amount_cents: 100000 },
    })

    // Net basis (default): 4000 vs 4000 → 50/50.
    let budget = await get(cookie, `/api/budget/${month}`)
    expect(budget.members.find((m: { id: string }) => m.id === aId).contribution_cents).toBe(50000)

    // Gross basis: 6000 vs 4000 → 60/40.
    await app.inject({ method: 'PATCH', url: '/api/household', cookies: cookie, payload: { split_basis: 'gross' } })
    budget = await get(cookie, `/api/budget/${month}`)
    expect(budget.members.find((m: { id: string }) => m.id === aId).contribution_cents).toBe(60000)
    expect(budget.members.find((m: { id: string }) => m.id === bId).contribution_cents).toBe(40000)
  })

  it('summarizes deductions and shows what every rule costs', async () => {
    const { cookie, aId, bId } = await createLinkedHousehold(app, ['Jake', 'Sam'], 'sum.dev')
    await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: cookie,
      payload: {
        user_id: aId,
        name: 'Salary',
        amount_cents: 0,
        gross_cents: 350000,
        deductions: [
          { name: 'Fed', amount_cents: 57000, kind: 'tax' },
          { name: '401k', amount_cents: 23000, kind: 'pretax' },
        ],
        cadence: 'biweekly',
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: cookie,
      payload: { user_id: bId, name: 'Salary', amount_cents: 200000, cadence: 'semimonthly' },
    })
    const summary = await get(cookie, `/api/income/summary?month=${month}`)
    const jake = summary.members.find((m: { user_id: string }) => m.user_id === aId)
    expect(jake.has_breakdown).toBe(true)
    expect(jake.gross_cents).toBe(Math.round((350000 * 26) / 12))
    expect(jake.tax_cents).toBe(Math.round((57000 * 26) / 12))
    expect(jake.net_cents).toBe(Math.round((270000 * 26) / 12))
    expect(summary.options).toHaveLength(3)
    expect(summary.active_key).toBe('net')
    const equal = summary.options.find((o: { key: string }) => o.key === 'equal')
    expect(equal.shares.every((s: { pct: number }) => s.pct === 50)).toBe(true)
  })
})
