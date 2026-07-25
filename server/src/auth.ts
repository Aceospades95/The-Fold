import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { UserPublic } from '@fold/shared'
import { now } from './lib/util.js'

export const SESSION_COOKIE = 'fold_session'
const SESSION_DAYS = 30

export interface SessionUser extends UserPublic {
  household_id: string
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `s2:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':')
  if (scheme !== 's2' || !salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createSession(db: DatabaseSync, userId: string): { token: string; maxAgeSeconds: number } {
  const token = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now())
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    expires,
    now(),
  )
  return { token, maxAgeSeconds: SESSION_DAYS * 24 * 60 * 60 }
}

export function destroySession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
}

export function userForToken(db: DatabaseSync, token: string): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.color, u.household_id
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), now()) as SessionUser | undefined
  return row ?? null
}

declare module 'fastify' {
  interface FastifyInstance {
    db: DatabaseSync
  }
  interface FastifyRequest {
    user: SessionUser
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[SESSION_COOKIE]
  const user = token ? userForToken(req.server.db, token) : null
  if (!user) {
    reply.code(401).send({ error: 'Not signed in' })
    return reply
  }
  req.user = user
}
