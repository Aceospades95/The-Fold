import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { buildApp } from './app.js'
import { openDb } from './db.js'
import { runDailyJobs } from './lib/webhooks.js'

const here = dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.FOLD_DB ?? resolve(here, '../../data/the-fold.db')
const staticDir = process.env.STATIC_DIR ?? resolve(here, '../../web/dist')
const port = Number(process.env.PORT ?? 8484)
const host = process.env.HOST ?? '0.0.0.0'

const db = openDb(dbPath)
const app = await buildApp({ db, staticDir })

try {
  await app.listen({ port, host })
  app.log.info(`The Fold is listening on http://${host}:${port} (db: ${dbPath})`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

// Post due recurring transactions and fire scheduled webhooks: once at boot
// (catch-up after downtime), then hourly — runDailyJobs itself no-ops until
// the calendar date changes.
runDailyJobs(db).catch((err) => app.log.error(err, 'daily jobs failed'))
setInterval(
  () => {
    runDailyJobs(db).catch((err) => app.log.error(err, 'daily jobs failed'))
  },
  60 * 60 * 1000,
).unref()
