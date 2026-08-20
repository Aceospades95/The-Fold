import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AccountType } from '@fold/shared'
import { insertTransactionRaw } from './tx.js'
import { getSetting, putSetting } from './webhooks.js'
import { id, now } from './util.js'

/**
 * SimpleFIN Bridge sync: the user connects their banks at the bridge
 * (bridge.simplefin.org), pastes the one-time setup token here, and from then
 * on posted transactions and balances pull themselves — same dedupe and
 * undoable-batch semantics as a hand-done statement import.
 */

export const SIMPLEFIN_KEY = 'simplefin'

export interface SimplefinConfig {
  access_url: string
  connected_at: string
  /** Unix seconds of the last successful sync. */
  last_sync: number | null
  last_error: string | null
  map: { sfin_id: string; sfin_name: string; account_id: string }[]
}

interface SfinTransaction {
  id: string
  posted: number
  amount: string
  description: string
  pending?: boolean
}

interface SfinAccount {
  id: string
  name: string
  org?: { name?: string }
  balance: string
  'balance-date': number
  transactions?: SfinTransaction[]
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
}>

export async function claimSetupToken(setupToken: string, fetchImpl: FetchLike = fetch): Promise<string> {
  let claimUrl: string
  try {
    claimUrl = Buffer.from(setupToken.trim(), 'base64').toString('utf8').trim()
    new URL(claimUrl)
  } catch {
    throw new Error('That does not look like a SimpleFIN setup token.')
  }
  const res = await fetchImpl(claimUrl, { method: 'POST' })
  if (!res.ok) throw new Error(`The bridge rejected the token (HTTP ${res.status}) — tokens are single-use, grab a fresh one.`)
  const accessUrl = (await res.text()).trim()
  try {
    new URL(accessUrl)
  } catch {
    throw new Error('The bridge returned something that is not an access URL.')
  }
  return accessUrl
}

/** Access URLs carry basic-auth credentials; fetch wants them as a header. */
function splitAccessUrl(accessUrl: string): { base: string; headers: Record<string, string> } {
  const url = new URL(accessUrl)
  const headers: Record<string, string> = {}
  if (url.username) {
    headers.authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`
    url.username = ''
    url.password = ''
  }
  return { base: url.toString().replace(/\/$/, ''), headers }
}

async function fetchAccounts(
  accessUrl: string,
  sinceUnix: number,
  fetchImpl: FetchLike,
): Promise<SfinAccount[]> {
  const { base, headers } = splitAccessUrl(accessUrl)
  const res = await fetchImpl(`${base}/accounts?start-date=${Math.floor(sinceUnix)}`, { headers })
  if (!res.ok) throw new Error(`SimpleFIN fetch failed (HTTP ${res.status}).`)
  const body = JSON.parse(await res.text()) as { accounts?: SfinAccount[]; errors?: string[] }
  if (body.errors && body.errors.length > 0) throw new Error(body.errors.join('; '))
  return body.accounts ?? []
}

function sfinHash(accountId: string, txId: string): string {
  return createHash('sha256').update(`sfin|${accountId}|${txId}`).digest('hex')
}

function guessType(name: string): AccountType {
  if (/credit|card/i.test(name)) return 'credit'
  if (/loan|mortgage/i.test(name)) return 'loan'
  if (/sav/i.test(name)) return 'savings'
  return 'checking'
}

function localDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const cents = (amount: string): number => Math.round(parseFloat(amount) * 100)

export interface SyncResult {
  accounts: number
  imported: number
  skipped: number
}

export async function syncSimplefin(
  db: DatabaseSync,
  householdId: string,
  fetchImpl: FetchLike = fetch,
): Promise<SyncResult> {
  const config = getSetting<SimplefinConfig>(db, householdId, SIMPLEFIN_KEY)
  if (!config) throw new Error('SimpleFIN is not connected.')
  const since = config.last_sync ? config.last_sync - 5 * 86400 : Math.floor(Date.now() / 1000) - 90 * 86400
  const accounts = await fetchAccounts(config.access_url, since, fetchImpl)

  // Bank transactions land on the household's admin by default (splits are a
  // human judgment — the classify queue and editing handle the rest).
  const payer = db
    .prepare('SELECT id FROM users WHERE household_id = ? ORDER BY created_at LIMIT 1')
    .get(householdId) as { id: string } | undefined
  if (!payer) throw new Error('No household member to book transactions against.')

  let imported = 0
  let skipped = 0
  const map = [...config.map]

  for (const account of accounts) {
    let mapping = map.find((m) => m.sfin_id === account.id)
    if (!mapping) {
      const name = account.org?.name ? `${account.org.name} ${account.name}` : account.name
      const accountId = id()
      db.prepare(
        'INSERT INTO accounts (id, household_id, name, type, owner_user_id, archived, sort, created_at) VALUES (?, ?, ?, ?, NULL, 0, 999, ?)',
      ).run(accountId, householdId, name.slice(0, 80), guessType(name), now())
      mapping = { sfin_id: account.id, sfin_name: account.name, account_id: accountId }
      map.push(mapping)
    }

    // Balance snapshot: liabilities store "what you owe" as a positive number.
    const accountRow = db
      .prepare('SELECT type FROM accounts WHERE id = ?')
      .get(mapping.account_id) as { type: AccountType } | undefined
    if (accountRow) {
      const raw = cents(account.balance)
      const balance = accountRow.type === 'credit' || accountRow.type === 'loan' ? Math.abs(raw) : raw
      db.prepare(
        `INSERT INTO account_snapshots (id, account_id, date, balance_cents) VALUES (?, ?, ?, ?)
         ON CONFLICT (account_id, date) DO UPDATE SET balance_cents = excluded.balance_cents`,
      ).run(id(), mapping.account_id, localDate(account['balance-date'] ?? Date.now() / 1000), balance)
    }

    const posted = (account.transactions ?? []).filter((t) => !t.pending)
    const fresh = posted.filter(
      (t) =>
        !db
          .prepare('SELECT 1 FROM transactions WHERE household_id = ? AND import_hash = ?')
          .get(householdId, sfinHash(mapping!.account_id, t.id)),
    )
    skipped += posted.length - fresh.length
    if (fresh.length === 0) continue

    const batchId = id()
    db.prepare(
      'INSERT INTO import_batches (id, household_id, account_id, filename, created_at, imported_count, total_cents) VALUES (?, ?, ?, ?, ?, 0, 0)',
    ).run(batchId, householdId, mapping.account_id, `SimpleFIN — ${account.name}`.slice(0, 120), now())
    let total = 0
    for (const tx of fresh) {
      // SimpleFIN: negative amount = money out. Fold: positive = expense,
      // negative = refund/credit.
      const amountCents = -cents(tx.amount)
      if (amountCents === 0) continue
      insertTransactionRaw(db, householdId, {
        kind: 'expense',
        date: localDate(tx.posted),
        description: tx.description.slice(0, 200) || 'Bank transaction',
        amount_cents: amountCents,
        payer_user_id: payer.id,
        account_id: mapping.account_id,
        import_batch_id: batchId,
        import_hash: sfinHash(mapping.account_id, tx.id),
        splits: [{ user_id: payer.id, share_cents: amountCents }],
      })
      total += amountCents
      imported += 1
    }
    db.prepare('UPDATE import_batches SET imported_count = ?, total_cents = ? WHERE id = ?').run(
      fresh.length,
      total,
      batchId,
    )
  }

  putSetting(db, householdId, SIMPLEFIN_KEY, {
    ...config,
    map,
    last_sync: Math.floor(Date.now() / 1000),
    last_error: null,
  } satisfies SimplefinConfig)
  return { accounts: accounts.length, imported, skipped }
}

/**
 * Daily-jobs hook: sync every household that has connected the bridge. Runs on
 * the hourly tick but holds each household to roughly one automatic pull a day
 * (the bridge's preferred pace) — the Sync-now button bypasses this.
 */
export async function syncAllSimplefin(db: DatabaseSync): Promise<void> {
  const rows = db
    .prepare(`SELECT household_id FROM settings WHERE key = ?`)
    .all(SIMPLEFIN_KEY) as { household_id: string }[]
  for (const { household_id } of rows) {
    try {
      const config = getSetting<SimplefinConfig>(db, household_id, SIMPLEFIN_KEY)
      if (config?.last_sync && Date.now() / 1000 - config.last_sync < 20 * 3600) continue
      await syncSimplefin(db, household_id)
    } catch (err) {
      const config = getSetting<SimplefinConfig>(db, household_id, SIMPLEFIN_KEY)
      if (config) {
        putSetting(db, household_id, SIMPLEFIN_KEY, { ...config, last_error: (err as Error).message })
      }
    }
  }
}
