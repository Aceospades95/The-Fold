import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { signup } from './helpers.js'

/**
 * The two-person lifecycle, end to end, as Jake and Sanya would live it:
 * separate logins, one shared budget, individual budgets on the side, and
 * every feature that has to agree on what "us" means. Each block builds on
 * the last, so this file reads top to bottom as the story of setting up.
 */

type Cookie = { fold_session: string }
let app: FastifyInstance
let jake: Cookie
let sanya: Cookie
let jakeId: string
let sanyaId: string
let householdId: string
const month = new Date().toISOString().slice(0, 7)
const today = new Date().toISOString().slice(0, 10)

async function as<T = any>(cookie: Cookie, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<T> {
  const res = await app.inject({ method, url, cookies: cookie, payload })
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode}: ${res.body}`)
  return res.json() as T
}
const status = async (cookie: Cookie, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<number> =>
  (await app.inject({ method, url, cookies: cookie, payload })).statusCode

const cat = (list: { name: string; scope: string; owner_user_id: string | null; id: string }[], name: string, owner: string | null = null) =>
  list.find((c) => c.name === name && (owner ? c.owner_user_id === owner : c.scope === 'shared'))!

beforeAll(async () => {
  app = await buildApp({ db: openDb(':memory:'), logger: false })
  const a = await signup(app, { name: 'Jake Wright', email: 'jake@fold.test' })
  jake = a.cookie
  jakeId = a.userId
  const invite = await as(jake, 'POST', '/api/invites')
  const b = await signup(app, { name: 'Sanya Lee', email: 'sanya@fold.test', invite_code: invite.code })
  sanya = b.cookie
  sanyaId = b.userId
})

afterAll(async () => {
  await app.close()
})

describe('1 · two logins, one household', () => {
  it('both see the same household, with distinct colors and the right admin', async () => {
    const meJ = await as(jake, 'GET', '/api/me')
    const meS = await as(sanya, 'GET', '/api/me')
    householdId = meJ.household.id
    expect(meS.household.id).toBe(householdId)
    expect(meJ.household.members.map((m: { name: string }) => m.name).sort()).toEqual(['Jake Wright', 'Sanya Lee'])
    expect(meS.household.members).toHaveLength(2)
    expect(meJ.user.is_admin).toBe(1)
    expect(meS.user.is_admin).toBe(0)
    const colors = meJ.household.members.map((m: { color: string }) => m.color)
    expect(new Set(colors).size).toBe(2)
    // The solo default name ("Jake’s budget") became "ours" the moment she joined.
    expect(meS.household.name).toBe('Jake & Sanya')
    expect(meJ.household.name).toBe('Jake & Sanya')
  })

  it('a custom household name is never overwritten', async () => {
    await as(jake, 'PATCH', '/api/household', { name: 'The Wright-Lee house' })
    expect((await as(sanya, 'GET', '/api/me')).household.name).toBe('The Wright-Lee house')
    await as(jake, 'PATCH', '/api/household', { name: 'Jake & Sanya' })
  })

  it('only the admin sees server controls; colors cannot collide', async () => {
    expect(await status(sanya, 'GET', '/api/instance')).toBe(403)
    expect(await status(sanya, 'GET', '/api/instance/users')).toBe(403)
    const info = await as(jake, 'GET', '/api/instance/users')
    expect(info.users.every((u: { household_members: number }) => u.household_members === 2)).toBe(true)

    const meJ = await as(jake, 'GET', '/api/me')
    expect(await status(sanya, 'PATCH', '/api/auth/profile', { color: meJ.user.color })).toBe(400)
    await as(sanya, 'PATCH', '/api/auth/profile', { color: '#f43f5e' })
    const seenByJake = await as(jake, 'GET', '/api/me')
    expect(seenByJake.household.members.find((m: { id: string }) => m.id === sanyaId).color).toBe('#f43f5e')
  })
})

describe('2 · incomes and the split', () => {
  it('each adds their own income; both see both; the shared split follows income', async () => {
    await as(jake, 'POST', '/api/income', {
      user_id: jakeId,
      name: 'Salary',
      amount_cents: 0,
      gross_cents: 350000,
      deductions: [
        { name: 'Federal tax', amount_cents: 50000, kind: 'tax' },
        { name: '401(k)', amount_cents: 21000, kind: 'pretax' },
        { name: 'Medical', amount_cents: 6000, kind: 'pretax' },
      ],
      cadence: 'biweekly',
    })
    await as(sanya, 'POST', '/api/income', { user_id: sanyaId, name: 'Salary', amount_cents: 400000, cadence: 'monthly' })

    const seenByJake = await as(jake, 'GET', '/api/income')
    const seenBySanya = await as(sanya, 'GET', '/api/income')
    expect(seenByJake.sources).toHaveLength(2)
    expect(seenBySanya.sources).toHaveLength(2)

    const budget = await as(sanya, 'GET', `/api/budget/${month}`)
    const jakeRow = budget.members.find((m: { id: string }) => m.id === jakeId)
    const sanyaRow = budget.members.find((m: { id: string }) => m.id === sanyaId)
    expect(jakeRow.monthly_income_cents).toBeGreaterThan(0)
    expect(sanyaRow.monthly_income_cents).toBe(400000)
    // Proportional by default: the higher earner carries the larger share.
    expect(jakeRow.monthly_income_cents).toBeGreaterThan(sanyaRow.monthly_income_cents)
    const summary = await as(jake, 'GET', `/api/income/summary?month=${month}`)
    expect(summary.active_key).toBe('net')
  })

  it('switching the split rule shows up for both immediately', async () => {
    await as(jake, 'PATCH', '/api/household', { split_rule: 'equal' })
    const meS = await as(sanya, 'GET', '/api/me')
    expect(meS.household.split_rule).toBe('equal')
    await as(sanya, 'PATCH', '/api/household', { split_rule: 'proportional' })
    const meJ = await as(jake, 'GET', '/api/me')
    expect(meJ.household.split_rule).toBe('proportional')
  })
})

describe('3 · one shared budget', () => {
  it('an envelope Jake sets is the envelope Sanya sees, and vice versa', async () => {
    const cats = (await as(jake, 'GET', '/api/categories')).categories
    const groceries = cat(cats, 'Groceries')
    const rent = cat(cats, 'Rent / Mortgage')
    await as(jake, 'PUT', `/api/budget/${month}/allocations`, { category_id: groceries.id, amount_cents: 60000 })
    await as(jake, 'PUT', `/api/budget/${month}/allocations`, { category_id: rent.id, amount_cents: 200000 })

    const sanyaView = await as(sanya, 'GET', `/api/budget/${month}`)
    expect(sanyaView.categories.find((c: { id: string }) => c.id === groceries.id).allocated_cents).toBe(60000)
    expect(sanyaView.shared_allocated_cents).toBe(260000)

    await as(sanya, 'PUT', `/api/budget/${month}/allocations`, { category_id: groceries.id, amount_cents: 65000 })
    const jakeView = await as(jake, 'GET', `/api/budget/${month}`)
    expect(jakeView.categories.find((c: { id: string }) => c.id === groceries.id).allocated_cents).toBe(65000)

    // Each person's contribution to the joint budget adds up to the whole thing.
    const contributions = jakeView.members.reduce((sum: number, m: { contribution_cents: number }) => sum + m.contribution_cents, 0)
    expect(contributions).toBe(jakeView.shared_allocated_cents)
  })

  it('shared spending splits and nets into one running balance', async () => {
    const cats = (await as(jake, 'GET', '/api/categories')).categories
    const groceries = cat(cats, 'Groceries')
    const dining = cat(cats, 'Dining out')
    await as(jake, 'POST', '/api/transactions', {
      date: `${month}-03`,
      description: 'Costco',
      amount_cents: 10000,
      category_id: groceries.id,
      payer_user_id: jakeId,
      splits: [
        { user_id: jakeId, share_cents: 5000 },
        { user_id: sanyaId, share_cents: 5000 },
      ],
    })
    let balances = await as(sanya, 'GET', '/api/balances')
    expect(balances.suggestion).toMatchObject({ from_user_id: sanyaId, to_user_id: jakeId, amount_cents: 5000 })

    await as(sanya, 'POST', '/api/transactions', {
      date: `${month}-04`,
      description: 'Thai place',
      amount_cents: 4000,
      category_id: dining.id,
      payer_user_id: sanyaId,
      splits: [
        { user_id: jakeId, share_cents: 2000 },
        { user_id: sanyaId, share_cents: 2000 },
      ],
    })
    balances = await as(jake, 'GET', '/api/balances')
    expect(balances.suggestion).toMatchObject({ from_user_id: sanyaId, to_user_id: jakeId, amount_cents: 3000 })

    // Both dashboards agree, and the shared envelopes show the spend.
    const sumJ = await as(jake, 'GET', '/api/summary')
    const sumS = await as(sanya, 'GET', '/api/summary')
    expect(sumJ.balances.suggestion.amount_cents).toBe(3000)
    expect(sumS.balances.suggestion.amount_cents).toBe(3000)
    expect(sumS.shared_spent_cents).toBe(14000)
    const budget = await as(sanya, 'GET', `/api/budget/${month}`)
    expect(budget.categories.find((c: { id: string }) => c.id === groceries.id).spent_cents).toBe(10000)
  })
})

describe('4 · individual budgets on the side', () => {
  it('each person has their own personal envelopes, and personal spending never splits', async () => {
    const cats = (await as(jake, 'GET', '/api/categories')).categories
    const jakeFun = cat(cats, 'Fun money', jakeId)
    const sanyaFun = cat(cats, 'Fun money', sanyaId)
    expect(jakeFun.id).not.toBe(sanyaFun.id)

    await as(jake, 'PUT', `/api/budget/${month}/allocations`, { category_id: jakeFun.id, amount_cents: 15000 })
    await as(sanya, 'PUT', `/api/budget/${month}/allocations`, { category_id: sanyaFun.id, amount_cents: 9000 })

    // "My personal budget" is per viewer.
    const sumJ = await as(jake, 'GET', '/api/summary')
    const sumS = await as(sanya, 'GET', '/api/summary')
    expect(sumJ.my_personal_allocated_cents).toBe(15000)
    expect(sumS.my_personal_allocated_cents).toBe(9000)

    const before = (await as(jake, 'GET', '/api/balances')).suggestion.amount_cents
    await as(jake, 'POST', '/api/transactions', {
      date: `${month}-05`,
      description: 'Video game',
      amount_cents: 6000,
      category_id: jakeFun.id,
      payer_user_id: jakeId,
      splits: [{ user_id: jakeId, share_cents: 6000 }],
    })
    await as(sanya, 'POST', '/api/transactions', {
      date: `${month}-06`,
      description: 'Yoga class',
      amount_cents: 2500,
      category_id: sanyaFun.id,
      payer_user_id: sanyaId,
      splits: [{ user_id: sanyaId, share_cents: 2500 }],
    })
    // Personal spending is nobody else's business: the who-owes-whom is untouched.
    expect((await as(sanya, 'GET', '/api/balances')).suggestion.amount_cents).toBe(before)

    const afterJ = await as(jake, 'GET', '/api/summary')
    const afterS = await as(sanya, 'GET', '/api/summary')
    expect(afterJ.my_personal_spent_cents).toBe(6000)
    expect(afterS.my_personal_spent_cents).toBe(2500)
    // …and it never leaks into the shared totals.
    expect(afterS.shared_spent_cents).toBe(14000)

    const budget = await as(jake, 'GET', `/api/budget/${month}`)
    expect(budget.categories.find((c: { id: string }) => c.id === jakeFun.id).spent_cents).toBe(6000)
    expect(budget.categories.find((c: { id: string }) => c.id === sanyaFun.id).spent_cents).toBe(2500)
    const jakeRow = budget.members.find((m: { id: string }) => m.id === jakeId)
    const sanyaRow = budget.members.find((m: { id: string }) => m.id === sanyaId)
    expect(jakeRow.personal_allocated_cents).toBe(15000)
    expect(sanyaRow.personal_allocated_cents).toBe(9000)
  })

  it('settling up zeroes the balance and shows as a settlement, not spending', async () => {
    const sharedBefore = (await as(jake, 'GET', '/api/summary')).shared_spent_cents
    await as(sanya, 'POST', '/api/settle', { from_user_id: sanyaId, to_user_id: jakeId, amount_cents: 3000, date: today })
    const balances = await as(jake, 'GET', '/api/balances')
    expect(balances.suggestion === null || balances.suggestion.amount_cents === 0).toBe(true)
    expect((await as(jake, 'GET', '/api/summary')).shared_spent_cents).toBe(sharedBefore)
    const txs = await as(sanya, 'GET', '/api/transactions')
    expect(txs.transactions.some((t: { kind: string }) => t.kind === 'settlement')).toBe(true)
  })
})

describe('5 · the plan belongs to both', () => {
  it('bootstraps from both real incomes and stays in sync between the two logins', async () => {
    const boot = await as(jake, 'GET', '/api/plan')
    const people = boot.state.people
    expect(people.map((p: { user_id: string }) => p.user_id).sort()).toEqual([jakeId, sanyaId].sort())
    const jakeP = people.find((p: { user_id: string }) => p.user_id === jakeId)
    const sanyaP = people.find((p: { user_id: string }) => p.user_id === sanyaId)
    expect(jakeP).toMatchObject({ name: 'Jake', pay_freq: 'biweekly', salary: 91000 })
    expect(sanyaP).toMatchObject({ name: 'Sanya', pay_freq: 'monthly', salary: 48000, color: '#f43f5e' })

    // Move 8 points from living into the first bucket — the split still totals 100.
    boot.state.buckets[0].pct += 8
    boot.state.living_pct -= 8
    const bucketPct = boot.state.buckets[0].pct
    await as(jake, 'PUT', '/api/plan', { state: boot.state })
    const seenBySanya = await as(sanya, 'GET', '/api/plan')
    expect(seenBySanya.state.buckets[0].pct).toBeCloseTo(bucketPct, 6)
    expect(seenBySanya.saved_by).toBe('Jake Wright')
  })

  it('applying the plan as the default fills untouched envelopes for both, keeping hand-set ones', async () => {
    const { state } = await as(sanya, 'GET', '/api/plan')
    const r = await as(sanya, 'POST', '/api/plan/apply', { month, mode: 'default', state })
    expect(r.mode).toBe('default')
    const budget = await as(jake, 'GET', `/api/budget/${month}`)
    expect(budget.default_effective).toBe(month)
    const cats = (await as(jake, 'GET', '/api/categories')).categories
    // Hand-set stays hand-set; something we never touched got filled by the plan.
    expect(budget.categories.find((c: { id: string }) => c.id === cat(cats, 'Groceries').id).allocated_cents).toBe(65000)
    const filled = budget.categories.filter((c: { scope: string; allocated_cents: number }) => c.scope === 'shared' && c.allocated_cents > 0)
    expect(filled.length).toBeGreaterThan(2)
  })
})

describe('6 · lists, trips, and net worth are shared too', () => {
  it('a chore Sanya assigns to Jake lands on Jake’s plate, not hers', async () => {
    const lists = (await as(sanya, 'GET', '/api/lists')).lists
    const chores = lists.find((l: { type: string }) => l.type === 'chores')
    const item = await as(sanya, 'POST', `/api/lists/${chores.id}/items`, {
      text: 'Take the bins out',
      assignee_user_id: jakeId,
      due_date: today,
    })
    const sumJ = await as(jake, 'GET', '/api/summary')
    const sumS = await as(sanya, 'GET', '/api/summary')
    expect(sumJ.my_tasks.some((t: { text: string }) => t.text === 'Take the bins out')).toBe(true)
    expect(sumS.my_tasks.some((t: { text: string }) => t.text === 'Take the bins out')).toBe(false)
    await as(jake, 'PATCH', `/api/list-items/${item.id}`, { done: 1 })
    expect((await as(jake, 'GET', '/api/summary')).my_tasks.some((t: { text: string }) => t.text === 'Take the bins out')).toBe(false)
  })

  it('a trip either of you plans shows up for both, on the dashboard and the calendar feed', async () => {
    await as(jake, 'POST', '/api/trips', {
      name: 'Pacific Coast Highway',
      status: 'planned',
      location: 'California',
      start_date: `${new Date().getFullYear() + 1}-05-10`,
      end_date: `${new Date().getFullYear() + 1}-05-17`,
      total_budget_cents: 270000,
    })
    const trips = await as(sanya, 'GET', '/api/trips')
    expect(trips.trips.some((t: { name: string }) => t.name === 'Pacific Coast Highway')).toBe(true)
    expect((await as(sanya, 'GET', '/api/summary')).next_trip?.name).toBe('Pacific Coast Highway')
    const meS = await as(sanya, 'GET', '/api/me')
    const ics = await app.inject({ method: 'GET', url: meS.household.calendar_path })
    expect(ics.statusCode).toBe(200)
    expect(ics.body).toContain('Pacific Coast Highway')
  })

  it('net worth combines both people’s accounts and joint ones', async () => {
    await as(jake, 'POST', '/api/accounts', { name: 'Jake checking', type: 'checking', owner_user_id: jakeId, balance_cents: 500000 })
    await as(sanya, 'POST', '/api/accounts', { name: 'Sanya savings', type: 'savings', owner_user_id: sanyaId, balance_cents: 300000 })
    await as(sanya, 'POST', '/api/accounts', { name: 'Joint emergency', type: 'savings', owner_user_id: null, balance_cents: 100000 })
    const nwJ = await as(jake, 'GET', '/api/networth')
    const nwS = await as(sanya, 'GET', '/api/networth')
    expect(nwJ.net_cents).toBe(900000)
    expect(nwS.net_cents).toBe(900000)
    expect(nwS.accounts).toHaveLength(3)
  })
})

describe('7 · every reporting surface works for both logins', () => {
  it('review, insights, trends, filters, duplicates, and export answer for each of you', async () => {
    for (const who of [jake, sanya]) {
      const review = await as(who, 'GET', `/api/review/${month}`)
      expect(review.month).toBe(month)
      expect(review.transactions_count).toBeGreaterThan(0)
      expect((await as(who, 'GET', '/api/insights?months=3')).flow ?? true).toBeTruthy()
      expect(await status(who, 'GET', '/api/budget-trends?months=3')).toBe(200)
      expect(await status(who, 'GET', '/api/transactions/duplicates')).toBe(200)
      expect(await status(who, 'GET', '/api/export/full.json')).toBe(200)
      expect(await status(who, 'GET', '/api/export/transactions.csv')).toBe(200)
    }
    const mine = await as(sanya, 'GET', `/api/transactions?payer=${sanyaId}`)
    expect(mine.transactions.length).toBeGreaterThan(0)
    expect(mine.transactions.every((t: { payer_user_id: string }) => t.payer_user_id === sanyaId)).toBe(true)
    // The raw database backup stays admin-only.
    expect(await status(sanya, 'GET', '/api/export/backup.sqlite')).toBe(403)
    expect(await status(jake, 'GET', '/api/export/backup.sqlite')).toBe(200)
  })

  it('a partner’s reset password logs them out everywhere and lets them back in', async () => {
    const reset = await as(jake, 'POST', '/api/instance/reset-password', { user_id: sanyaId })
    expect(await status(sanya, 'GET', '/api/me')).toBe(401)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'sanya@fold.test', password: reset.temp_password } })
    expect(login.statusCode).toBe(200)
  })
})
