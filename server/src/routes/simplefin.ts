import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  SIMPLEFIN_KEY,
  type SimplefinConfig,
  claimSetupToken,
  syncSimplefin,
} from '../lib/simplefin.js'
import { getSetting, putSetting } from '../lib/webhooks.js'
import { badRequest } from '../lib/util.js'

export async function simplefinRoutes(app: FastifyInstance): Promise<void> {
  app.get('/simplefin', async (req) => {
    const config = getSetting<SimplefinConfig>(app.db, req.user.household_id, SIMPLEFIN_KEY)
    if (!config) return { connected: false }
    const accounts = config.map.map((m) => {
      const account = app.db.prepare('SELECT name FROM accounts WHERE id = ?').get(m.account_id) as
        | { name: string }
        | undefined
      return { sfin_name: m.sfin_name, account_id: m.account_id, account_name: account?.name ?? '(removed)' }
    })
    return {
      connected: true,
      connected_at: config.connected_at,
      last_sync: config.last_sync ? new Date(config.last_sync * 1000).toISOString() : null,
      last_error: config.last_error,
      accounts,
    }
  })

  app.post('/simplefin/connect', async (req) => {
    const { setup_token } = z.object({ setup_token: z.string().trim().min(8).max(4000) }).parse(req.body)
    const householdId = req.user.household_id
    if (getSetting<SimplefinConfig>(app.db, householdId, SIMPLEFIN_KEY)) {
      badRequest('SimpleFIN is already connected — disconnect first to start over.')
    }
    const access_url = await claimSetupToken(setup_token)
    putSetting(app.db, householdId, SIMPLEFIN_KEY, {
      access_url,
      connected_at: new Date().toISOString(),
      last_sync: null,
      last_error: null,
      map: [],
    } satisfies SimplefinConfig)
    try {
      const result = await syncSimplefin(app.db, householdId)
      return { connected: true, ...result }
    } catch (err) {
      const config = getSetting<SimplefinConfig>(app.db, householdId, SIMPLEFIN_KEY)!
      putSetting(app.db, householdId, SIMPLEFIN_KEY, { ...config, last_error: (err as Error).message })
      return { connected: true, error: (err as Error).message }
    }
  })

  app.post('/simplefin/sync', async (req) => {
    try {
      return await syncSimplefin(app.db, req.user.household_id)
    } catch (err) {
      const config = getSetting<SimplefinConfig>(app.db, req.user.household_id, SIMPLEFIN_KEY)
      if (config) {
        putSetting(app.db, req.user.household_id, SIMPLEFIN_KEY, { ...config, last_error: (err as Error).message })
      }
      badRequest((err as Error).message)
    }
  })

  app.delete('/simplefin', async (req) => {
    app.db
      .prepare('DELETE FROM settings WHERE household_id = ? AND key = ?')
      .run(req.user.household_id, SIMPLEFIN_KEY)
    return { ok: true }
  })
}
