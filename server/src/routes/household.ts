import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { InviteInfo, MeResponse, SplitBasis, SplitRule } from '@fold/shared'
import { hashPassword } from '../auth.js'
import { createInvite, formatInviteCode, redeemInviteCode } from '../lib/merge.js'
import { getMembers } from '../lib/queries.js'
import { badRequest, id, now } from '../lib/util.js'
import { nextMemberColor, seedPersonalDefaults } from './auth.js'

const patchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  split_rule: z.enum(['equal', 'proportional', 'custom']).optional(),
  split_basis: z.enum(['net', 'gross']).optional(),
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
  split_basis: SplitBasis
  custom_split: string | null
  calendar_token: string
}

export async function householdRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', async (req): Promise<MeResponse> => {
    const hh = app.db
      .prepare('SELECT id, name, split_rule, split_basis, custom_split, calendar_token FROM households WHERE id = ?')
      .get(req.user.household_id) as unknown as HouseholdRow
    return {
      user: { id: req.user.id, name: req.user.name, email: req.user.email, color: req.user.color },
      household: {
        id: hh.id,
        name: hh.name,
        split_rule: hh.split_rule,
        split_basis: hh.split_basis,
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
    if (body.split_basis !== undefined) {
      app.db.prepare('UPDATE households SET split_basis = ? WHERE id = ?').run(body.split_basis, req.user.household_id)
    }
    if (body.custom_split !== undefined) {
      app.db
        .prepare('UPDATE households SET custom_split = ? WHERE id = ?')
        .run(body.custom_split ? JSON.stringify(body.custom_split) : null, req.user.household_id)
    }
    return { ok: true }
  })

  /** Active (unused, unexpired) invite codes for this household. */
  app.get('/invites', async (req): Promise<{ invites: InviteInfo[] }> => {
    const rows = app.db
      .prepare(
        `SELECT code, expires_at FROM invites
         WHERE household_id = ? AND used_by_user_id IS NULL AND expires_at > ?
         ORDER BY created_at DESC`,
      )
      .all(req.user.household_id, now()) as { code: string; expires_at: string }[]
    return { invites: rows.map((row) => ({ code: formatInviteCode(row.code), expires_at: row.expires_at })) }
  })

  app.post('/invites', async (req): Promise<InviteInfo> => {
    return createInvite(app.db, req.user.household_id, req.user.id)
  })

  /** Link this (solo) account into a partner's household using their code. */
  app.post('/invites/redeem', async (req) => {
    const { code } = z.object({ code: z.string().trim().min(4).max(20) }).parse(req.body)
    const result = redeemInviteCode(app.db, code, req.user.id)
    // If none of their solo envelopes survived the merge (nothing was used
    // yet), give them the starter personal envelopes in the new household.
    const personal = (
      app.db
        .prepare(
          `SELECT COUNT(*) AS c FROM categories WHERE household_id = ? AND scope = 'personal' AND owner_user_id = ?`,
        )
        .get(result.householdId, req.user.id) as { c: number }
    ).c
    if (personal === 0) seedPersonalDefaults(app.db, result.householdId, req.user.id)
    return { household_id: result.householdId }
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
    const userId = id()
    app.db
      .prepare(
        'INSERT INTO users (id, household_id, name, email, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        userId,
        req.user.household_id,
        body.name,
        body.email,
        hashPassword(body.password),
        nextMemberColor(app.db, req.user.household_id),
        now(),
      )
    seedPersonalDefaults(app.db, req.user.household_id, userId)
    return { id: userId }
  })

  app.post('/household/calendar-token/rotate', async (req) => {
    const token = randomBytes(16).toString('hex')
    app.db.prepare('UPDATE households SET calendar_token = ? WHERE id = ?').run(token, req.user.household_id)
    return { calendar_path: `/api/calendar/${token}/the-fold.ics` }
  })
}
