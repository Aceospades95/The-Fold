import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { createLinkedHousehold, sessionCookie, signup } from './helpers.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await buildApp({ db: openDb(':memory:'), logger: false })
})

afterEach(async () => {
  await app.close()
})

describe('change password', () => {
  it('rejects a wrong current password and honors the new one', async () => {
    const a = await signup(app, { name: 'Jake', email: 'jake@sec.dev' })

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      cookies: a.cookie,
      payload: { current_password: 'nope', new_password: 'newsecret' },
    })
    expect(wrong.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      cookies: a.cookie,
      payload: { current_password: 'secret1', new_password: 'newsecret' },
    })
    expect(ok.statusCode).toBe(200)

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'jake@sec.dev', password: 'secret1' },
    })
    expect(oldLogin.statusCode).toBe(401)
    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'jake@sec.dev', password: 'newsecret' },
    })
    expect(newLogin.statusCode).toBe(200)
  })

  it('signs out every other device but keeps this one', async () => {
    const a = await signup(app, { name: 'Jake', email: 'jake@multi.dev' })
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'jake@multi.dev', password: 'secret1' },
    })
    const secondCookie = sessionCookie(second.headers['set-cookie'])

    const before = (await app.inject({ method: 'GET', url: '/api/auth/sessions', cookies: a.cookie })).json()
    expect(before.sessions).toHaveLength(2)
    expect(before.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1)

    await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      cookies: a.cookie,
      payload: { current_password: 'secret1', new_password: 'rotated1' },
    })

    // The other device's session is gone; this one still works.
    const evicted = await app.inject({ method: 'GET', url: '/api/me', cookies: secondCookie })
    expect(evicted.statusCode).toBe(401)
    const kept = await app.inject({ method: 'GET', url: '/api/me', cookies: a.cookie })
    expect(kept.statusCode).toBe(200)
  })

  it('logout-others counts what it evicted', async () => {
    const a = await signup(app, { name: 'Jake', email: 'jake@evict.dev' })
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'jake@evict.dev', password: 'secret1' } })
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'jake@evict.dev', password: 'secret1' } })
    const result = (await app.inject({ method: 'POST', url: '/api/auth/logout-others', cookies: a.cookie })).json()
    expect(result.signed_out).toBe(2)
  })
})

describe('sliding sessions', () => {
  it('renews a session past its halfway mark and re-issues the cookie', async () => {
    const a = await signup(app, { name: 'Jake', email: 'jake@slide.dev' })
    // Backdate the session so only 5 days remain of the 30-day window.
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    ;(app as FastifyInstance & { db: any }).db
      .prepare('UPDATE sessions SET expires_at = ?')
      .run(soon)

    const res = await app.inject({ method: 'GET', url: '/api/me', cookies: a.cookie })
    expect(res.statusCode).toBe(200)
    expect(String(res.headers['set-cookie'])).toContain('fold_session=')
    const row = (app as FastifyInstance & { db: any }).db
      .prepare('SELECT expires_at FROM sessions LIMIT 1')
      .get() as { expires_at: string }
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.now() + 25 * 24 * 60 * 60 * 1000)

    // A fresh session (nowhere near halfway) is left alone.
    const again = await app.inject({ method: 'GET', url: '/api/me', cookies: a.cookie })
    expect(again.headers['set-cookie']).toBeUndefined()
  })
})

describe('profile edits', () => {
  it('renames, re-emails, and refuses a taken email', async () => {
    const { cookie, cookieB } = await createLinkedHousehold(app, ['Jake', 'Sam'], 'prof.dev')

    const renamed = await app.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      cookies: cookie,
      payload: { name: 'Jacob', email: 'jacob@prof.dev' },
    })
    expect(renamed.statusCode).toBe(200)
    const me = (await app.inject({ method: 'GET', url: '/api/me', cookies: cookie })).json()
    expect(me.user.name).toBe('Jacob')
    expect(me.user.email).toBe('jacob@prof.dev')

    const collision = await app.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      cookies: cookieB,
      payload: { email: 'jacob@prof.dev' },
    })
    expect(collision.statusCode).toBe(400)
    expect(collision.json().error).toContain('already in use')
  })
})

describe('admin password reset', () => {
  it('issues a one-time password, kills old sessions, and gates on admin', async () => {
    const { cookie, cookieB, aId, bId } = await createLinkedHousehold(app, ['Jake', 'Sam'], 'reset.dev')

    const notAdmin = await app.inject({
      method: 'POST',
      url: '/api/instance/reset-password',
      cookies: cookieB,
      payload: { user_id: aId },
    })
    expect(notAdmin.statusCode).toBe(403)

    const self = await app.inject({
      method: 'POST',
      url: '/api/instance/reset-password',
      cookies: cookie,
      payload: { user_id: aId },
    })
    expect(self.statusCode).toBe(400)

    const reset = (
      await app.inject({
        method: 'POST',
        url: '/api/instance/reset-password',
        cookies: cookie,
        payload: { user_id: bId },
      })
    ).json()
    expect(reset.temp_password.length).toBeGreaterThanOrEqual(6)

    // Sam's old password and old session are both dead; the temp one works.
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'sam@reset.dev', password: 'secret1' },
    })
    expect(oldLogin.statusCode).toBe(401)
    const oldSession = await app.inject({ method: 'GET', url: '/api/me', cookies: cookieB })
    expect(oldSession.statusCode).toBe(401)
    const tempLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'sam@reset.dev', password: reset.temp_password },
    })
    expect(tempLogin.statusCode).toBe(200)
  })
})

describe('data export', () => {
  it('dumps the household without password hashes and scopes to the household', async () => {
    const { cookie, aId } = await createLinkedHousehold(app, ['Jake', 'Sam'], 'exp.dev')
    const month = new Date().toISOString().slice(0, 7)
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      cookies: cookie,
      payload: {
        date: `${month}-05`,
        description: 'Export me',
        amount_cents: 1234,
        payer_user_id: aId,
        splits: [{ user_id: aId, share_cents: 1234 }],
      },
    })
    const res = await app.inject({ method: 'GET', url: '/api/export/full.json', cookies: cookie })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('attachment')
    const dump = res.json()
    expect(dump.transactions.some((t: { description: string }) => t.description === 'Export me')).toBe(true)
    expect(dump.users).toHaveLength(2)
    for (const user of dump.users) expect(user.password_hash).toBeUndefined()
    expect(dump.categories.length).toBeGreaterThan(5)
  })

  it('renders transactions as CSV with categories and splits', async () => {
    const { cookie, aId, bId } = await createLinkedHousehold(app, ['Jake', 'Sam'], 'csv.dev')
    const month = new Date().toISOString().slice(0, 7)
    const categories = (await app.inject({ method: 'GET', url: '/api/categories', cookies: cookie })).json()
    const groceries = categories.categories.find((c: { name: string; scope: string }) => c.name === 'Groceries' && c.scope === 'shared')
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      cookies: cookie,
      payload: {
        date: `${month}-08`,
        description: 'Costco, with "quotes"',
        amount_cents: 10000,
        category_id: groceries.id,
        payer_user_id: aId,
        splits: [
          { user_id: aId, share_cents: 5000 },
          { user_id: bId, share_cents: 5000 },
        ],
      },
    })
    const res = await app.inject({ method: 'GET', url: '/api/export/transactions.csv', cookies: cookie })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    const lines = res.body.trim().split('\n')
    expect(lines[0]).toBe('date,description,store,kind,amount,categories,split,account,paid_by,cleared,notes')
    expect(lines[1]).toContain('"Costco, with ""quotes"""')
    expect(lines[1]).toContain('Groceries')
    expect(lines[1]).toContain('Jake 50.00; Sam 50.00')
  })

  it('carries the plan, scenarios, and import profiles in the JSON export', async () => {
    const { cookie } = await createLinkedHousehold(app, ['Jake', 'Sam'], 'planexp.dev')
    const planR = (await app.inject({ method: 'GET', url: '/api/plan', cookies: cookie })).json()
    await app.inject({ method: 'PUT', url: '/api/plan', cookies: cookie, payload: { state: planR.state } })
    await app.inject({
      method: 'POST',
      url: '/api/plan/scenarios',
      cookies: cookie,
      payload: { name: 'Keeper', state: planR.state },
    })
    const dump = (await app.inject({ method: 'GET', url: '/api/export/full.json', cookies: cookie })).json()
    expect(dump.plan.state.v).toBe(2)
    expect(dump.plan_scenarios).toHaveLength(1)
    expect(dump.plan_scenarios[0].name).toBe('Keeper')
    expect(Array.isArray(dump.import_profiles)).toBe(true)
  })

  it('lets only the admin download the raw backup', async () => {
    const { cookie, cookieB } = await createLinkedHousehold(app, ['Jake', 'Sam'], 'bak.dev')
    const denied = await app.inject({ method: 'GET', url: '/api/export/backup.sqlite', cookies: cookieB })
    expect(denied.statusCode).toBe(403)
    const res = await app.inject({ method: 'GET', url: '/api/export/backup.sqlite', cookies: cookie })
    expect(res.statusCode).toBe(200)
    // SQLite files open with a fixed 16-byte magic header.
    expect(res.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3')
  })
})
