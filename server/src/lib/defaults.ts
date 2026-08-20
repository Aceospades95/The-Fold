import type { DatabaseSync } from 'node:sqlite'
import { getSetting, putSetting } from './webhooks.js'
import { currentMonth, id, shiftMonth } from './util.js'

/**
 * Default budgets with effective dates. A household stores a list of default
 * budgets, each effective "from month X onward". A month with no allocations
 * fills itself from the applicable default the first time anyone looks at it
 * (rows marked source='default'); anything a human sets — an edit, a move, a
 * quick-fill, a one-month plan apply — is source='manual' and is never touched
 * when a new default lands. Months before an entry's effective date stay
 * exactly as they were, so history never shifts under your feet.
 */

export const BUDGET_DEFAULTS_KEY = 'budget_defaults'

export interface BudgetDefault {
  /** YYYY-MM this default starts applying (inclusive). */
  from_month: string
  /** category_id → monthly cents. */
  allocations: Record<string, number>
  saved_at: string
  saved_by: string | null
}

export function getBudgetDefaults(db: DatabaseSync, householdId: string): BudgetDefault[] {
  const list = getSetting<BudgetDefault[]>(db, householdId, BUDGET_DEFAULTS_KEY) ?? []
  return [...list].sort((a, b) => a.from_month.localeCompare(b.from_month))
}

/** The default in force for a month: the latest entry starting on or before it. */
export function applicableDefault(defaults: BudgetDefault[], month: string): BudgetDefault | null {
  let match: BudgetDefault | null = null
  for (const entry of defaults) {
    if (entry.from_month <= month) match = entry
  }
  return match
}

/**
 * Store a default effective from `entry.from_month` (replacing any entry with
 * the same start month) and clear default-materialized rows from that month
 * forward so they re-fill from the new numbers. Manual rows are left alone.
 */
export function saveBudgetDefault(db: DatabaseSync, householdId: string, entry: BudgetDefault): void {
  const rest = getBudgetDefaults(db, householdId).filter((d) => d.from_month !== entry.from_month)
  rest.push(entry)
  rest.sort((a, b) => a.from_month.localeCompare(b.from_month))
  putSetting(db, householdId, BUDGET_DEFAULTS_KEY, rest)
  db.prepare(
    `DELETE FROM allocations WHERE source = 'default' AND month >= ?
     AND category_id IN (SELECT id FROM categories WHERE household_id = ?)`,
  ).run(entry.from_month, householdId)
}

/**
 * Fill a month's missing envelopes from the applicable default. Idempotent and
 * per-row: existing rows (manual or default) are never overwritten, so it is
 * safe to run on every read. Returns how many rows it wrote.
 */
export function materializeMonth(db: DatabaseSync, householdId: string, month: string): number {
  const entry = applicableDefault(getBudgetDefaults(db, householdId), month)
  if (!entry) return 0
  let written = 0
  const insert = db.prepare(
    `INSERT INTO allocations (id, category_id, month, amount_cents, source) VALUES (?, ?, ?, ?, 'default')`,
  )
  for (const [categoryId, cents] of Object.entries(entry.allocations)) {
    if (!Number.isFinite(cents) || cents <= 0) continue
    const category = db
      .prepare('SELECT id FROM categories WHERE id = ? AND household_id = ? AND archived = 0')
      .get(categoryId, householdId)
    if (!category) continue
    const existing = db
      .prepare('SELECT id FROM allocations WHERE category_id = ? AND month = ?')
      .get(categoryId, month)
    if (existing) continue
    insert.run(id(), categoryId, month, Math.round(cents))
    written += 1
  }
  return written
}

/**
 * Daily-jobs hook: keep the current and next month materialized for every
 * household with a default, so rollover math and reports see real rows even
 * before anyone opens the Budget page that month.
 */
export function materializeAllDefaults(db: DatabaseSync): void {
  const rows = db
    .prepare('SELECT household_id FROM settings WHERE key = ?')
    .all(BUDGET_DEFAULTS_KEY) as { household_id: string }[]
  const thisMonth = currentMonth()
  const nextMonth = shiftMonth(thisMonth, 1)
  for (const { household_id } of rows) {
    materializeMonth(db, household_id, thisMonth)
    materializeMonth(db, household_id, nextMonth)
  }
}
