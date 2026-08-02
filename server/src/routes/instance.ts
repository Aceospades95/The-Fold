import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpError } from '../lib/util.js'
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
}
