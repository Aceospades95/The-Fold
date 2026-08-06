import type { DatabaseSync } from 'node:sqlite'
import { id, now } from './util.js'

export interface TxLineInput {
  category_id?: string | null
  amount_cents: number
  note?: string | null
}

export interface TxInput {
  kind: 'expense' | 'settlement'
  date: string
  description: string
  amount_cents: number
  /** Single-category shorthand; ignored when `lines` is provided. */
  category_id?: string | null
  payer_user_id: string
  account_id?: string | null
  merchant_id?: string | null
  import_batch_id?: string | null
  trip_expense_id?: string | null
  recurring_id?: string | null
  import_hash?: string | null
  notes?: string | null
  cleared?: 0 | 1
  splits: { user_id: string; share_cents: number }[]
  lines?: TxLineInput[]
}

export function normalizeLines(input: TxInput): TxLineInput[] {
  if (input.lines && input.lines.length > 0) return input.lines
  return [{ category_id: input.category_id ?? null, amount_cents: input.amount_cents, note: null }]
}

/** The mirrored category on the transaction row: only meaningful with one line. */
export function primaryCategory(lines: TxLineInput[]): string | null {
  return lines.length === 1 ? (lines[0].category_id ?? null) : null
}

export function writeLines(db: DatabaseSync, transactionId: string, lines: TxLineInput[]): void {
  db.prepare('DELETE FROM transaction_lines WHERE transaction_id = ?').run(transactionId)
  const insert = db.prepare(
    'INSERT INTO transaction_lines (id, transaction_id, category_id, amount_cents, note, sort) VALUES (?, ?, ?, ?, ?, ?)',
  )
  lines.forEach((line, index) => {
    insert.run(id(), transactionId, line.category_id ?? null, line.amount_cents, line.note ?? null, index)
  })
  db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run(primaryCategory(lines), transactionId)
}

export function insertTransactionRaw(db: DatabaseSync, householdId: string, input: TxInput): string {
  const txId = id()
  const lines = normalizeLines(input)
  db.prepare(
    `INSERT INTO transactions (id, household_id, kind, date, description, amount_cents, category_id, payer_user_id, account_id, merchant_id, import_batch_id, trip_expense_id, recurring_id, import_hash, notes, cleared, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    txId,
    householdId,
    input.kind,
    input.date,
    input.description,
    input.amount_cents,
    primaryCategory(lines),
    input.payer_user_id,
    input.account_id ?? null,
    input.merchant_id ?? null,
    input.import_batch_id ?? null,
    input.trip_expense_id ?? null,
    input.recurring_id ?? null,
    input.import_hash ?? null,
    input.notes ?? null,
    input.cleared ?? (input.import_hash != null ? 1 : 0),
    now(),
  )
  const insertSplit = db.prepare(
    'INSERT INTO transaction_splits (id, transaction_id, user_id, share_cents) VALUES (?, ?, ?, ?)',
  )
  for (const split of input.splits) {
    insertSplit.run(id(), txId, split.user_id, split.share_cents)
  }
  writeLines(db, txId, lines)
  return txId
}
