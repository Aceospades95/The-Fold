import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiTokenInfo, HaConfig } from '@fold/shared'
import { DEFAULT_HA_CONFIG, fireWebhook, getHaConfig, putSetting, runDailyJobs } from '../lib/webhooks.js'
import { badRequest, id, notFound, now } from '../lib/util.js'

const haBody = z.object({
  url: z.string().trim().url().nullable(),
  events: z
    .object({
      item_due: z.boolean(),
      trip_countdown: z.boolean(),
      budget_over: z.boolean(),
    })
    .partial()
    .optional(),
})

const tokenBody = z.object({ name: z.string().trim().min(1).max(60) })

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/integrations/ha', async (req): Promise<HaConfig> => {
    return getHaConfig(app.db, req.user.household_id)
  })

  app.patch('/integrations/ha', async (req) => {
    const body = haBody.parse(req.body)
    const current = getHaConfig(app.db, req.user.household_id)
    const next: HaConfig = {
      url: body.url,
      events: { ...DEFAULT_HA_CONFIG.events, ...current.events, ...body.events },
    }
    putSetting(app.db, req.user.household_id, 'home_assistant', next)
    return next
  })

  app.post('/integrations/ha/test', async (req) => {
    const config = getHaConfig(app.db, req.user.household_id)
    if (!config.url) badRequest('Save a webhook URL first.')
    const result = await fireWebhook(config.url!, 'test', {
      message: 'Hello from The Fold 🪺 — your webhook works.',
    })
    if (!result.ok) {
      badRequest(
        result.error
          ? `Could not reach the webhook: ${result.error}`
          : `Webhook responded with HTTP ${result.status}.`,
      )
    }
    return { ok: true }
  })

  app.post('/integrations/run-daily', async (req) => {
    await runDailyJobs(app.db, { force: true })
    return { ok: true }
  })

  app.get('/integrations/tokens', async (req): Promise<{ tokens: ApiTokenInfo[] }> => {
    const tokens = app.db
      .prepare(
        'SELECT id, name, created_at, last_used_at FROM api_tokens WHERE household_id = ? ORDER BY created_at',
      )
      .all(req.user.household_id) as unknown as ApiTokenInfo[]
    return { tokens }
  })

  app.post('/integrations/tokens', async (req) => {
    const body = tokenBody.parse(req.body)
    const token = `fold_${randomBytes(24).toString('hex')}`
    const tokenId = id()
    app.db
      .prepare('INSERT INTO api_tokens (id, household_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(tokenId, req.user.household_id, body.name, hashApiToken(token), now())
    return { id: tokenId, token }
  })

  app.delete('/integrations/tokens/:id', async (req) => {
    const { id: tokenId } = req.params as { id: string }
    const result = app.db
      .prepare('DELETE FROM api_tokens WHERE id = ? AND household_id = ?')
      .run(tokenId, req.user.household_id)
    if (result.changes === 0) notFound('Token')
    return { ok: true }
  })
}
