import type { DatabaseSync } from 'node:sqlite'
import { id, now } from './util.js'

export interface TxInput {
  kind: 'expense' | 'settlement'
  date: string
  description: string
  amount_cents: number
  category_id?: string | null
  payer_user_id: string
  trip_expense_id?: string | null
  recurring_id?: string | null
  import_hash?: string | null
  notes?: string | null
  splits: { user_id: string; share_cents: number }[]
}

export function insertTransactionRaw(db: DatabaseSync, householdId: string, input: TxInput): string {
  const txId = id()
  db.prepare(
    `INSERT INTO transactions (id, household_id, kind, date, description, amount_cents, category_id, payer_user_id, trip_expense_id, recurring_id, import_hash, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    txId,
    householdId,
    input.kind,
    input.date,
    input.description,
    input.amount_cents,
    input.category_id ?? null,
    input.payer_user_id,
    input.trip_expense_id ?? null,
    input.recurring_id ?? null,
    input.import_hash ?? null,
    input.notes ?? null,
    now(),
  )
  const insertSplit = db.prepare(
    'INSERT INTO transaction_splits (id, transaction_id, user_id, share_cents) VALUES (?, ?, ?, ?)',
  )
  for (const split of input.splits) {
    insertSplit.run(id(), txId, split.user_id, split.share_cents)
  }
  return txId
}
