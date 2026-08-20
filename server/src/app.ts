import Fastify, { type FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { ZodError } from 'zod'
import { requireAuth } from './auth.js'
import { HttpError } from './lib/util.js'
import { privateAuthRoutes, publicAuthRoutes } from './routes/auth.js'
import { budgetRoutes } from './routes/budget.js'
import { calendarRoutes } from './routes/calendar.js'
import { exportRoutes } from './routes/exporting.js'
import { hookRoutes } from './routes/hooks.js'
import { householdRoutes } from './routes/household.js'
import { importRoutes } from './routes/importing.js'
import { incomeRoutes } from './routes/income.js'
import { insightsRoutes } from './routes/insights.js'
import { integrationRoutes } from './routes/integrations.js'
import { instanceRoutes } from './routes/instance.js'
import { listRoutes } from './routes/lists.js'
import { merchantRoutes } from './routes/merchants.js'
import { netWorthRoutes } from './routes/networth.js'
import { planRoutes } from './routes/plan.js'
import { recurringRoutes } from './routes/recurring.js'
import { reviewRoutes } from './routes/review.js'
import { simplefinRoutes } from './routes/simplefin.js'
import { summaryRoutes } from './routes/summary.js'
import { transactionRoutes } from './routes/transactions.js'
import { tripRoutes } from './routes/trips.js'

export interface AppOptions {
  db: DatabaseSync
  staticDir?: string
  logger?: boolean
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true })
  app.decorate('db', opts.db)
  await app.register(fastifyCookie)

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const issue = err.issues[0]
      const path = issue?.path.join('.')
      reply.code(400).send({ error: `${path ? path + ': ' : ''}${issue?.message ?? 'Invalid request'}` })
      return
    }
    if (err instanceof HttpError) {
      reply.code(err.statusCode).send({ error: err.message })
      return
    }
    req.log.error(err)
    const fastifyErr = err as { statusCode?: number; message?: string }
    const code = fastifyErr.statusCode && fastifyErr.statusCode < 500 ? fastifyErr.statusCode : 500
    reply.code(code).send({
      error: code < 500 ? (fastifyErr.message ?? 'Request failed') : 'Something went wrong',
    })
  })

  await app.register(publicAuthRoutes, { prefix: '/api' })
  await app.register(calendarRoutes, { prefix: '/api' })
  await app.register(hookRoutes, { prefix: '/api' })
  await app.register(privateAuthRoutes, { prefix: '/api' })
  await app.register(
    async (priv) => {
      priv.addHook('onRequest', requireAuth)
      await priv.register(householdRoutes)
      await priv.register(incomeRoutes)
      await priv.register(budgetRoutes)
      await priv.register(transactionRoutes)
      await priv.register(recurringRoutes)
      await priv.register(importRoutes)
      await priv.register(netWorthRoutes)
      await priv.register(merchantRoutes)
      await priv.register(instanceRoutes)
      await priv.register(integrationRoutes)
      await priv.register(tripRoutes)
      await priv.register(listRoutes)
      await priv.register(summaryRoutes)
      await priv.register(exportRoutes)
      await priv.register(reviewRoutes)
      await priv.register(insightsRoutes)
      await priv.register(planRoutes)
      await priv.register(simplefinRoutes)
    },
    { prefix: '/api' },
  )

  app.get('/api/health', async () => ({ ok: true, app: 'the-fold' }))

  if (opts.staticDir && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, {
      root: opts.staticDir,
      setHeaders: (res, filePath) => {
        // Vite content-hashes everything under /assets — cache those forever;
        // index.html must always revalidate so deploys show up immediately.
        if (/[\\/]assets[\\/]/.test(filePath)) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable')
        } else {
          res.setHeader('cache-control', 'no-cache')
        }
      },
    })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html')
      }
      reply.code(404).send({ error: 'Not found' })
    })
  }

  return app
}
