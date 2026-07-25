import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { MeResponse, SplitRule } from '@fold/shared'
import { hashPassword } from '../auth.js'
import { getMembers } from '../lib/queries.js'
import { badRequest, id, now } from '../lib/util.js'

const patchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  split_rule: z.enum(['equal', 'proportional', 'custom']).optional(),
  custom_split: z.record(z.string(), z.number().min(0).max(100)).nullable().optional(),
})

const memberBody = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(6).max(200),
})

interface HouseholdRow {
  id: string
  name: string
  split_rule: SplitRule
  custom_split: string | null
  calendar_token: string
}

export async function householdRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', async (req): Promise<MeResponse> => {
    const hh = app.db
      .prepare('SELECT id, name, split_rule, custom_split, calendar_token FROM households WHERE id = ?')
      .get(req.user.household_id) as unknown as HouseholdRow
    return {
      user: { id: req.user.id, name: req.user.name, email: req.user.email, color: req.user.color },
      household: {
        id: hh.id,
        name: hh.name,
        split_rule: hh.split_rule,
        custom_split: hh.custom_split ? JSON.parse(hh.custom_split) : null,
        calendar_path: `/api/calendar/${hh.calendar_token}/the-fold.ics`,
        members: getMembers(app.db, hh.id),
      },
    }
  })

  app.patch('/household', async (req) => {
    const body = patchBody.parse(req.body)
    if (body.custom_split) {
      const total = Object.values(body.custom_split).reduce((sum, v) => sum + v, 0)
      if (Math.round(total) !== 100) badRequest('Custom split percentages must add up to 100.')
    }
    if (body.name !== undefined) {
      app.db.prepare('UPDATE households SET name = ? WHERE id = ?').run(body.name, req.user.household_id)
    }
    if (body.split_rule !== undefined) {
      app.db.prepare('UPDATE households SET split_rule = ? WHERE id = ?').run(body.split_rule, req.user.household_id)
    }
    if (body.custom_split !== undefined) {
      app.db
        .prepare('UPDATE households SET custom_split = ? WHERE id = ?')
        .run(body.custom_split ? JSON.stringify(body.custom_split) : null, req.user.household_id)
    }
    return { ok: true }
  })

  app.post('/household/members', async (req) => {
    const body = memberBody.parse(req.body)
    const count = (
      app.db.prepare('SELECT COUNT(*) AS c FROM users WHERE household_id = ?').get(req.user.household_id) as {
        c: number
      }
    ).c
    if (count >= 4) badRequest('This household is full.')
    const existing = app.db.prepare('SELECT id FROM users WHERE email = ?').get(body.email)
    if (existing) badRequest('That email is already in use.')
    const colors = ['#8b5cf6', '#10b981', '#f59e0b', '#3b82f6']
    const userId = id()
    app.db
      .prepare(
        'INSERT INTO users (id, household_id, name, email, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(userId, req.user.household_id, body.name, body.email, hashPassword(body.password), colors[count % 4], now())
    return { id: userId }
  })

  app.post('/household/calendar-token/rotate', async (req) => {
    const token = randomBytes(16).toString('hex')
    app.db.prepare('UPDATE households SET calendar_token = ? WHERE id = ?').run(token, req.user.household_id)
    return { calendar_path: `/api/calendar/${token}/the-fold.ics` }
  })
}
