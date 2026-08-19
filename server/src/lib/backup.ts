import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { today } from './util.js'

const KEEP = 14

/**
 * Drop a consistent, dated copy of the database next to it (backups/ subfolder)
 * and prune old ones. Runs with the daily jobs; a same-day rerun overwrites, so
 * the newest state of each day wins. `:memory:` databases (tests) are skipped.
 */
export function runDailyBackup(db: DatabaseSync, dbPath: string): string | null {
  if (dbPath === ':memory:') return null
  const dir = join(dirname(resolve(dbPath)), 'backups')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, `the-fold-${today()}.sqlite`)
  rmSync(target, { force: true })
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)

  const stale = readdirSync(dir)
    .filter((name) => /^the-fold-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name))
    .sort()
    .slice(0, -KEEP)
  for (const name of stale) rmSync(join(dir, name), { force: true })
  return target
}
