import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { runDailyBackup } from '../src/lib/backup.js'
import { signup } from './helpers.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp({ db: openDb(':memory:'), logger: false })
  // First account is the admin on an invite-only server; open signup for the rest of the file.
  const admin = await signup(app, { name: 'Admin', email: 'admin@limit.dev' })
  await app.inject({ method: 'PATCH', url: '/api/instance', cookies: admin.cookie, payload: { open_signup: true } })
})

afterAll(async () => {
  await app.close()
})

describe('login rate limiting', () => {
  it('locks an account after repeated failures, even with the right password', async () => {
    await signup(app, { name: 'Target', email: 'target@limit.dev' })
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'target@limit.dev', password: 'wrong-guess' },
      })
      expect(res.statusCode).toBe(401)
    }
    const locked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'target@limit.dev', password: 'secret1' },
    })
    expect(locked.statusCode).toBe(429)
    expect(locked.json().error).toContain('Too many attempts')
  })

  it('a successful login resets the counter for that account', async () => {
    await signup(app, { name: 'Fine', email: 'fine@limit.dev' })
    for (let i = 0; i < 9; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'fine@limit.dev', password: 'nope' },
      })
    }
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'fine@limit.dev', password: 'secret1' },
    })
    expect(ok.statusCode).toBe(200)
    // Counter cleared: more headroom again.
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'fine@limit.dev', password: 'nope' },
    })
    expect(again.statusCode).toBe(401)
  })
})

describe('daily backups', () => {
  it('writes a dated copy next to the db and prunes old ones', () => {
    const dir = join(tmpdir(), `fold-backup-test-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const dbPath = join(dir, 'the-fold.db')
    const db = openDb(dbPath)
    try {
      // Pre-seed 20 fake old backups so pruning has something to chew on.
      const backupsDir = join(dir, 'backups')
      mkdirSync(backupsDir, { recursive: true })
      for (let i = 1; i <= 20; i++) {
        writeFileSync(join(backupsDir, `the-fold-2020-01-${String(i).padStart(2, '0')}.sqlite`), 'old')
      }

      const target = runDailyBackup(db, dbPath)
      expect(target).toBeTruthy()
      expect(existsSync(target!)).toBe(true)

      const remaining = readdirSync(backupsDir).filter((n) => n.endsWith('.sqlite'))
      expect(remaining).toHaveLength(14)
      // The newest survive: today's backup plus the 13 most recent fakes.
      expect(remaining).toContain(`the-fold-2020-01-20.sqlite`)
      expect(remaining).not.toContain(`the-fold-2020-01-07.sqlite`)

      // Same-day rerun overwrites instead of failing.
      expect(runDailyBackup(db, dbPath)).toBe(target)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips in-memory databases', () => {
    expect(runDailyBackup(app.db, ':memory:')).toBeNull()
  })
})
