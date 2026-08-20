import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { hashPassword } from '../auth.js'
import { HttpError, badRequest, notFound } from '../lib/util.js'
import { openSignupEnabled } from './auth.js'

/** Server-wide controls, visible only to the instance admin (the first account). */
export async function instanceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/instance', async (req) => {
    if (!req.user.is_admin) throw new HttpError(403, 'Only the server admin can see this.')
    const users = (app.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c
    const households = (app.db.prepare('SELECT COUNT(*) AS c FROM households').get() as { c: number }).c
    return { open_signup: openSignupEnabled(app), users, households }
  })

  app.patch('/instance', async (req) => {
    if (!req.user.is_admin) throw new HttpError(403, 'Only the server admin can change this.')
    const { open_signup } = z.object({ open_signup: z.boolean() }).parse(req.body)
    app.db
      .prepare(
        `INSERT INTO instance_settings (key, value) VALUES ('open_signup', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(open_signup ? 'true' : 'false')
    return { open_signup }
  })

  /**
   * The no-SMTP recovery path: the admin issues a one-time password for a
   * locked-out partner and reads it to them; every session of theirs is
   * signed out so the old password is dead everywhere at once.
   */
  app.post('/instance/reset-password', async (req) => {
    if (!req.user.is_admin) throw new HttpError(403, 'Only the server admin can reset passwords.')
    const { user_id } = z.object({ user_id: z.string() }).parse(req.body)
    if (user_id === req.user.id) badRequest('Change your own password under Settings, Your account.')
    const target = app.db
      .prepare('SELECT id, name FROM users WHERE id = ? AND household_id = ?')
      .get(user_id, req.user.household_id) as { id: string; name: string } | undefined
    if (!target) notFound('That person')
    const tempPassword = randomBytes(6).toString('base64url')
    app.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(tempPassword), target!.id)
    app.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target!.id)
    return { name: target!.name, temp_password: tempPassword }
  })
}
