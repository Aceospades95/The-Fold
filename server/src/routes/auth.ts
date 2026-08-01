import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  hashPassword,
  requireAuth,
  userForToken,
  verifyPassword,
} from '../auth.js'
import { normalizeInviteCode, redeemInviteCode } from '../lib/merge.js'
import { MEMBER_COLORS, badRequest, id, now } from '../lib/util.js'

const signupBody = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(6).max(200),
  household_name: z.string().trim().min(1).max(80).optional(),
  invite_code: z.string().trim().min(4).max(20).optional(),
})

const loginBody = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string(),
})

const DEFAULT_GROUPS = [
  { key: 'home', name: 'Home', emoji: '🏠' },
  { key: 'food', name: 'Food', emoji: '🍽️' },
  { key: 'transport', name: 'Getting around', emoji: '🚗' },
  { key: 'life', name: 'Life & health', emoji: '💗' },
  { key: 'goals', name: 'Goals & sinking funds', emoji: '🎯' },
]

const DEFAULT_SHARED_CATEGORIES: {
  name: string
  emoji: string
  group: string
  rollover?: 0 | 1
  bucket?: 'need' | 'want' | 'save'
}[] = [
  { name: 'Rent / Mortgage', emoji: '🏠', group: 'home' },
  { name: 'Utilities', emoji: '💡', group: 'home' },
  { name: 'Internet & phone', emoji: '📶', group: 'home' },
  { name: 'Household', emoji: '🧺', group: 'home' },
  { name: 'Home repairs', emoji: '🔧', group: 'home', rollover: 1 },
  { name: 'Groceries', emoji: '🛒', group: 'food' },
  { name: 'Dining out', emoji: '🍜', group: 'food', bucket: 'want' },
  { name: 'Gas', emoji: '⛽', group: 'transport' },
  { name: 'Car insurance', emoji: '🛡️', group: 'transport', rollover: 1 },
  { name: 'Car maintenance', emoji: '🔩', group: 'transport', rollover: 1 },
  { name: 'Health', emoji: '🩺', group: 'life' },
  { name: 'Pets', emoji: '🐾', group: 'life' },
  { name: 'Gifts', emoji: '🎁', group: 'life', rollover: 1, bucket: 'want' },
  { name: 'Travel', emoji: '✈️', group: 'goals', rollover: 1, bucket: 'save' },
  { name: 'Emergency fund', emoji: '🏦', group: 'goals', rollover: 1, bucket: 'save' },
]

const DEFAULT_PERSONAL_CATEGORIES = [
  { name: 'Fun money', emoji: '🎉' },
  { name: 'Subscriptions', emoji: '📱' },
]

const DEFAULT_LISTS = [
  { name: 'To-dos', type: 'todo', emoji: '✅' },
  { name: 'Groceries', type: 'grocery', emoji: '🛒' },
  { name: 'Chores', type: 'chores', emoji: '🧹' },
  { name: 'Wishlist', type: 'wishlist', emoji: '🌟' },
]

/** Starter groups, shared envelopes, and lists for a brand-new household. */
export function seedHouseholdDefaults(db: DatabaseSync, householdId: string): void {
  const groupIds = new Map<string, string>()
  DEFAULT_GROUPS.forEach((group, index) => {
    const groupId = id()
    groupIds.set(group.key, groupId)
    db.prepare('INSERT INTO category_groups (id, household_id, name, emoji, sort) VALUES (?, ?, ?, ?, ?)').run(
      groupId,
      householdId,
      group.name,
      group.emoji,
      index,
    )
  })
  const insertCategory = db.prepare(
    `INSERT INTO categories (id, household_id, name, emoji, scope, owner_user_id, group_id, rollover, bucket, sort)
     VALUES (?, ?, ?, ?, 'shared', NULL, ?, ?, ?, ?)`,
  )
  DEFAULT_SHARED_CATEGORIES.forEach((cat, index) => {
    insertCategory.run(
      id(),
      householdId,
      cat.name,
      cat.emoji,
      groupIds.get(cat.group) ?? null,
      cat.rollover ?? 0,
      cat.bucket ?? 'need',
      index,
    )
  })
  DEFAULT_LISTS.forEach((list, index) => {
    db.prepare('INSERT INTO lists (id, household_id, name, type, emoji, sort) VALUES (?, ?, ?, ?, ?, ?)').run(
      id(),
      householdId,
      list.name,
      list.type,
      list.emoji,
      index,
    )
  })
}

/** Personal envelopes for one member of a household. */
export function seedPersonalDefaults(db: DatabaseSync, householdId: string, userId: string): void {
  const insertCategory = db.prepare(
    `INSERT INTO categories (id, household_id, name, emoji, scope, owner_user_id, group_id, rollover, bucket, sort)
     VALUES (?, ?, ?, ?, 'personal', ?, NULL, 0, 'want', ?)`,
  )
  DEFAULT_PERSONAL_CATEGORIES.forEach((cat, index) => {
    insertCategory.run(id(), householdId, cat.name, cat.emoji, userId, 100 + index)
  })
}

export function nextMemberColor(db: DatabaseSync, householdId: string): string {
  const used = (
    db.prepare('SELECT color FROM users WHERE household_id = ?').all(householdId) as { color: string }[]
  ).map((row) => row.color)
  return MEMBER_COLORS.find((color) => !used.includes(color)) ?? MEMBER_COLORS[used.length % MEMBER_COLORS.length]
}

export function setCookie(reply: { setCookie: Function }, token: string, maxAgeSeconds: number): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: maxAgeSeconds,
  })
}

export async function publicAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/bootstrap', async (req) => {
    const token = req.cookies[SESSION_COOKIE]
    const user = token ? userForToken(app.db, token) : null
    return {
      user: user ? { id: user.id, name: user.name, email: user.email, color: user.color } : null,
    }
  })

  app.post('/signup', async (req, reply) => {
    const body = signupBody.parse(req.body)
    const existing = app.db.prepare('SELECT id FROM users WHERE email = ?').get(body.email)
    if (existing) badRequest('That email already has an account — sign in instead.')

    const userId = id()

    if (body.invite_code) {
      // Join the inviter's household directly — no solo household to merge later.
      const { householdId } = redeemInviteCode(app.db, body.invite_code, null)
      app.db
        .prepare(
          'INSERT INTO users (id, household_id, name, email, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(userId, householdId, body.name, body.email, hashPassword(body.password), nextMemberColor(app.db, householdId), now())
      app.db
        .prepare('UPDATE invites SET used_by_user_id = ?, used_at = ? WHERE code = ?')
        .run(userId, now(), normalizeInviteCode(body.invite_code))
      seedPersonalDefaults(app.db, householdId, userId)
    } else {
      const householdId = id()
      const firstName = body.name.split(/\s+/)[0]
      app.db
        .prepare(
          'INSERT INTO households (id, name, split_rule, custom_split, calendar_token, created_at) VALUES (?, ?, ?, NULL, ?, ?)',
        )
        .run(householdId, body.household_name ?? `${firstName}’s budget`, 'proportional', randomBytes(16).toString('hex'), now())
      app.db
        .prepare(
          'INSERT INTO users (id, household_id, name, email, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(userId, householdId, body.name, body.email, hashPassword(body.password), MEMBER_COLORS[0], now())
      seedHouseholdDefaults(app.db, householdId)
      seedPersonalDefaults(app.db, householdId, userId)
    }

    const session = createSession(app.db, userId)
    setCookie(reply, session.token, session.maxAgeSeconds)
    const user = app.db.prepare('SELECT id, name, email, color FROM users WHERE id = ?').get(userId)
    return { user }
  })

  app.post('/auth/login', async (req, reply) => {
    const body = loginBody.parse(req.body)
    const row = app.db
      .prepare('SELECT id, name, email, color, password_hash FROM users WHERE email = ?')
      .get(body.email) as { id: string; name: string; email: string; color: string; password_hash: string } | undefined
    if (!row || !verifyPassword(body.password, row.password_hash)) {
      reply.code(401)
      return { error: 'Wrong email or password' }
    }
    const session = createSession(app.db, row.id)
    setCookie(reply, session.token, session.maxAgeSeconds)
    return { user: { id: row.id, name: row.name, email: row.email, color: row.color } }
  })
}

export async function privateAuthRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireAuth)

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (token) destroySession(app.db, token)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })
}

