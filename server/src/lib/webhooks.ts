import type { DatabaseSync } from 'node:sqlite'
import type { HaConfig } from '@fold/shared'
import { materializeRecurring } from './recurring.js'
import { addDays, monthRange, now, today } from './util.js'

export function getSetting<T>(db: DatabaseSync, householdId: string, key: string): T | null {
  const row = db
    .prepare('SELECT value FROM settings WHERE household_id = ? AND key = ?')
    .get(householdId, key) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as T) : null
}

export function putSetting(db: DatabaseSync, householdId: string, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (household_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT (household_id, key) DO UPDATE SET value = excluded.value`,
  ).run(householdId, key, JSON.stringify(value))
}

export const DEFAULT_HA_CONFIG: HaConfig = {
  url: null,
  events: { item_due: true, trip_countdown: true, budget_over: true },
}

export function getHaConfig(db: DatabaseSync, householdId: string): HaConfig {
  return getSetting<HaConfig>(db, householdId, 'home_assistant') ?? DEFAULT_HA_CONFIG
}

export async function fireWebhook(
  url: string,
  event: string,
  data: unknown,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'the-fold', event, sent_at: now(), data }),
      signal: AbortSignal.timeout(10_000),
    })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

interface DailyContext {
  db: DatabaseSync
  householdId: string
  config: HaConfig
}

async function fireItemDue({ db, householdId, config }: DailyContext): Promise<void> {
  const items = db
    .prepare(
      `SELECT li.text, li.due_date, l.name AS list_name, u.name AS assignee
       FROM list_items li
       JOIN lists l ON l.id = li.list_id
       LEFT JOIN users u ON u.id = li.assignee_user_id
       WHERE l.household_id = ? AND li.done = 0 AND li.due_date <= ?`,
    )
    .all(householdId, today()) as { text: string; due_date: string; list_name: string; assignee: string | null }[]
  if (items.length > 0 && config.url) {
    await fireWebhook(config.url, 'item_due', { items })
  }
}

async function fireTripCountdown({ db, householdId, config }: DailyContext): Promise<void> {
  const markers = [7, 3, 1, 0]
  for (const days of markers) {
    const target = addDays(today(), days)
    const trips = db
      .prepare(
        `SELECT name, emoji, location, start_date, end_date FROM trips
         WHERE household_id = ? AND start_date = ? AND status IN ('planned', 'active')`,
      )
      .all(householdId, target) as { name: string }[]
    if (trips.length > 0 && config.url) {
      await fireWebhook(config.url, 'trip_countdown', { days_until: days, trips })
    }
  }
}

async function fireBudgetOver({ db, householdId, config }: DailyContext): Promise<void> {
  const month = today().slice(0, 7)
  const { start, end } = monthRange(month)
  const rows = db
    .prepare(
      `SELECT c.id, c.name, a.amount_cents AS allocated,
              COALESCE((SELECT SUM(t.amount_cents) FROM transactions t
                        WHERE t.category_id = c.id AND t.kind = 'expense' AND t.date >= ? AND t.date < ?), 0) AS spent
       FROM categories c JOIN allocations a ON a.category_id = c.id AND a.month = ?
       WHERE c.household_id = ? AND c.archived = 0 AND a.amount_cents > 0`,
    )
    .all(start, end, month, householdId) as { id: string; name: string; allocated: number; spent: number }[]
  const over = rows.filter((r) => r.spent > r.allocated)
  if (over.length === 0) return

  const notifiedKey = `budget_over_notified:${month}`
  const notified = new Set(getSetting<string[]>(db, householdId, notifiedKey) ?? [])
  const fresh = over.filter((r) => !notified.has(r.id))
  if (fresh.length > 0 && config.url) {
    await fireWebhook(config.url, 'budget_over', {
      month,
      categories: fresh.map((r) => ({ name: r.name, allocated_cents: r.allocated, spent_cents: r.spent })),
    })
    putSetting(db, householdId, notifiedKey, [...notified, ...fresh.map((r) => r.id)])
  }
}

/**
 * Daily housekeeping: post due recurring transactions, then fire enabled
 * Home Assistant events. Safe to call often — it no-ops until the date changes.
 */
export async function runDailyJobs(db: DatabaseSync, opts: { force?: boolean } = {}): Promise<void> {
  const households = db.prepare('SELECT id FROM households').all() as { id: string }[]
  materializeRecurring(db)
  for (const { id: householdId } of households) {
    const lastRun = getSetting<string>(db, householdId, 'last_daily_run')
    if (!opts.force && lastRun === today()) continue
    putSetting(db, householdId, 'last_daily_run', today())
    const config = getHaConfig(db, householdId)
    if (!config.url) continue
    const context = { db, householdId, config }
    if (config.events.item_due) await fireItemDue(context)
    if (config.events.trip_countdown) await fireTripCountdown(context)
    if (config.events.budget_over) await fireBudgetOver(context)
  }
}
