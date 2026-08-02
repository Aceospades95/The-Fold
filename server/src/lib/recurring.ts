import type { DatabaseSync } from 'node:sqlite'
import type { RecurringCadence, Split } from '@fold/shared'
import { insertTransactionRaw } from './tx.js'
import { today } from './util.js'

export function clampDay(year: number, month: number, day: number): string {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const clamped = Math.min(day, daysInMonth)
  return `${year}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`
}

/** First occurrence on/after `from` for a given day-of-month. */
export function firstOccurrence(from: string, dayOfMonth: number): string {
  const [y, m] = from.split('-').map(Number)
  const thisMonth = clampDay(y, m, dayOfMonth)
  if (thisMonth >= from) return thisMonth
  const next = new Date(Date.UTC(y, m, 1))
  return clampDay(next.getUTCFullYear(), next.getUTCMonth() + 1, dayOfMonth)
}

export function advance(date: string, cadence: RecurringCadence, dayOfMonth: number): string {
  const [y, m] = date.split('-').map(Number)
  if (cadence === 'yearly') return clampDay(y + 1, m, dayOfMonth)
  const next = new Date(Date.UTC(y, m, 1))
  return clampDay(next.getUTCFullYear(), next.getUTCMonth() + 1, dayOfMonth)
}

interface RecurringRow {
  id: string
  household_id: string
  description: string
  amount_cents: number
  category_id: string | null
  payer_user_id: string
  splits: string
  cadence: RecurringCadence
  day_of_month: number
  next_date: string
  notes: string | null
}

/** Post every due occurrence of every active recurring transaction. Returns how many were created. */
export function materializeRecurring(db: DatabaseSync): number {
  const cutoff = today()
  const due = db
    .prepare('SELECT * FROM recurring_transactions WHERE active = 1 AND next_date <= ?')
    .all(cutoff) as unknown as RecurringRow[]
  let created = 0
  for (const recurring of due) {
    const splits = JSON.parse(recurring.splits) as Split[]
    let date = recurring.next_date
    while (date <= cutoff) {
      insertTransactionRaw(db, recurring.household_id, {
        kind: 'expense',
        date,
        description: recurring.description,
        amount_cents: recurring.amount_cents,
        category_id: recurring.category_id,
        payer_user_id: recurring.payer_user_id,
        recurring_id: recurring.id,
        notes: recurring.notes,
        splits,
      })
      created += 1
      date = advance(date, recurring.cadence, recurring.day_of_month)
    }
    db.prepare('UPDATE recurring_transactions SET next_date = ? WHERE id = ?').run(date, recurring.id)
  }
  return created
}
