import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  hashPassword,
  requireAuth,
  verifyPassword,
} from '../auth.js'
import { badRequest, id, now } from '../lib/util.js'

const MEMBER_COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#3b82f6']

const userInput = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(6).max(200),
})

const setupBody = z.object({
  household_name: z.string().trim().min(1).max(80),
  you: userInput,
  partner: userInput.optional(),
})

const loginBody = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string(),
})

const DEFAULT_SHARED_CATEGORIES = [
  { name: 'Rent / Mortgage', emoji: '🏠' },
  { name: 'Groceries', emoji: '🛒' },
  { name: 'Utilities', emoji: '💡' },
  { name: 'Dining out', emoji: '🍽️' },
  { name: 'Travel', emoji: '✈️' },
  { name: 'Household', emoji: '🧺' },
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
    const count = (app.db.prepare('SELECT COUNT(*) AS c FROM households').get() as { c: number }).c
    const token = req.cookies[SESSION_COOKIE]
    let user = null
    if (token) {
      const { userForToken } = await import('../auth.js')
      user = userForToken(app.db, token)
    }
    return {
      needs_setup: count === 0,
      user: user ? { id: user.id, name: user.name, email: user.email, color: user.color } : null,
    }
  })

  app.post('/setup', async (req, reply) => {
    const body = setupBody.parse(req.body)
    const existing = (app.db.prepare('SELECT COUNT(*) AS c FROM households').get() as { c: number }).c
    if (existing > 0) badRequest('The Fold is already set up. Sign in instead.')
    if (body.partner && body.partner.email === body.you.email) badRequest('You and your partner need different emails.')

    const householdId = id()
    app.db
      .prepare(
        'INSERT INTO households (id, name, split_rule, custom_split, calendar_token, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(householdId, body.household_name, 'proportional', null, randomBytes(16).toString('hex'), now())

    const memberInputs = body.partner ? [body.you, body.partner] : [body.you]
    const userIds: string[] = []
    memberInputs.forEach((input, index) => {
      const userId = id()
      userIds.push(userId)
      app.db
        .prepare(
          'INSERT INTO users (id, household_id, name, email, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(userId, householdId, input.name, input.email, hashPassword(input.password), MEMBER_COLORS[index], now())
    })

    DEFAULT_SHARED_CATEGORIES.forEach((cat, index) => {
      app.db
        .prepare(
          'INSERT INTO categories (id, household_id, name, emoji, scope, owner_user_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id(), householdId, cat.name, cat.emoji, 'shared', null, index)
    })
    for (const userId of userIds) {
      DEFAULT_PERSONAL_CATEGORIES.forEach((cat, index) => {
        app.db
          .prepare(
            'INSERT INTO categories (id, household_id, name, emoji, scope, owner_user_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(id(), householdId, cat.name, cat.emoji, 'personal', userId, 100 + index)
      })
    }
    DEFAULT_LISTS.forEach((list, index) => {
      app.db
        .prepare('INSERT INTO lists (id, household_id, name, type, emoji, sort) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id(), householdId, list.name, list.type, list.emoji, index)
    })

    const session = createSession(app.db, userIds[0])
    setCookie(reply, session.token, session.maxAgeSeconds)
    const user = memberInputs[0]
    return { user: { id: userIds[0], name: user.name, email: user.email, color: MEMBER_COLORS[0] } }
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
