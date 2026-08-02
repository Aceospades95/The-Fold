import type { DatabaseSync } from 'node:sqlite'
import type { BalancesResponse, Member, Split, Tx, TxLine } from '@fold/shared'
import { monthlyCents } from '@fold/shared'
import type { Cadence } from '@fold/shared'

export function getMembers(db: DatabaseSync, householdId: string): Member[] {
  const users = db
    .prepare('SELECT id, name, email, color FROM users WHERE household_id = ? ORDER BY created_at')
    .all(householdId) as { id: string; name: string; email: string; color: string }[]
  const incomes = db
    .prepare(
      `SELECT i.user_id, i.amount_cents, i.gross_cents, i.cadence
       FROM income_sources i JOIN users u ON u.id = i.user_id
       WHERE u.household_id = ? AND i.active = 1`,
    )
    .all(householdId) as { user_id: string; amount_cents: number; gross_cents: number | null; cadence: Cadence }[]
  return users.map((u) => {
    const mine = incomes.filter((i) => i.user_id === u.id)
    return {
      ...u,
      monthly_income_cents: mine.reduce((sum, i) => sum + monthlyCents(i.amount_cents, i.cadence), 0),
      monthly_gross_cents: mine.reduce((sum, i) => sum + monthlyCents(i.gross_cents ?? i.amount_cents, i.cadence), 0),
    }
  })
}

export function getTransactions(
  db: DatabaseSync,
  householdId: string,
  opts: {
    start?: string
    end?: string
    limit?: number
    uncategorizedOnly?: boolean
    q?: string
    categoryId?: string
    accountId?: string
    payerId?: string
  } = {},
): Tx[] {
  let sql = `SELECT id, kind, date, description, amount_cents, category_id, payer_user_id, account_id, import_batch_id, trip_expense_id, recurring_id, notes
             FROM transactions WHERE household_id = ?`
  const params: (string | number)[] = [householdId]
  if (opts.uncategorizedOnly) {
    sql += ` AND kind = 'expense' AND EXISTS (
               SELECT 1 FROM transaction_lines tl WHERE tl.transaction_id = transactions.id AND tl.category_id IS NULL
             )`
  }
  if (opts.q) {
    sql += ' AND description LIKE ?'
    params.push(`%${opts.q}%`)
  }
  if (opts.categoryId) {
    sql += ` AND EXISTS (
               SELECT 1 FROM transaction_lines tl WHERE tl.transaction_id = transactions.id AND tl.category_id = ?
             )`
    params.push(opts.categoryId)
  }
  if (opts.accountId) {
    sql += ' AND account_id = ?'
    params.push(opts.accountId)
  }
  if (opts.payerId) {
    sql += ' AND payer_user_id = ?'
    params.push(opts.payerId)
  }
  if (opts.start) {
    sql += ' AND date >= ?'
    params.push(opts.start)
  }
  if (opts.end) {
    sql += ' AND date < ?'
    params.push(opts.end)
  }
  sql += ' ORDER BY date DESC, created_at DESC'
  if (opts.limit) {
    sql += ' LIMIT ?'
    params.push(opts.limit)
  }
  const rows = db.prepare(sql).all(...params) as Omit<Tx, 'splits' | 'lines'>[]
  if (rows.length === 0) return []
  const placeholders = rows.map(() => '?').join(',')
  const ids = rows.map((r) => r.id)
  const splits = db
    .prepare(
      `SELECT transaction_id, user_id, share_cents FROM transaction_splits WHERE transaction_id IN (${placeholders})`,
    )
    .all(...ids) as unknown as (Split & { transaction_id: string })[]
  const lines = db
    .prepare(
      `SELECT id, transaction_id, category_id, amount_cents, note FROM transaction_lines
       WHERE transaction_id IN (${placeholders}) ORDER BY sort`,
    )
    .all(...ids) as unknown as (TxLine & { transaction_id: string })[]
  return rows.map((r) => ({
    ...r,
    splits: splits
      .filter((s) => s.transaction_id === r.id)
      .map(({ user_id, share_cents }) => ({ user_id, share_cents })),
    lines: lines
      .filter((l) => l.transaction_id === r.id)
      .map(({ id: lineId, category_id, amount_cents, note }) => ({ id: lineId, category_id, amount_cents, note })),
  }))
}

export function getBalances(db: DatabaseSync, householdId: string): BalancesResponse {
  const members = db.prepare('SELECT id FROM users WHERE household_id = ? ORDER BY created_at').all(householdId) as {
    id: string
  }[]
  const paid = db
    .prepare(
      'SELECT payer_user_id AS user_id, SUM(amount_cents) AS total FROM transactions WHERE household_id = ? GROUP BY payer_user_id',
    )
    .all(householdId) as { user_id: string; total: number }[]
  const shares = db
    .prepare(
      `SELECT ts.user_id AS user_id, SUM(ts.share_cents) AS total
       FROM transaction_splits ts JOIN transactions t ON t.id = ts.transaction_id
       WHERE t.household_id = ? GROUP BY ts.user_id`,
    )
    .all(householdId) as { user_id: string; total: number }[]

  const balances = members.map((m) => {
    const paid_cents = paid.find((p) => p.user_id === m.id)?.total ?? 0
    const share_cents = shares.find((s) => s.user_id === m.id)?.total ?? 0
    return { user_id: m.id, paid_cents, share_cents, net_cents: paid_cents - share_cents }
  })

  let suggestion: BalancesResponse['suggestion'] = null
  if (balances.length === 2) {
    const creditor = balances.find((b) => b.net_cents > 0)
    const debtor = balances.find((b) => b.net_cents < 0)
    if (creditor && debtor) {
      suggestion = {
        from_user_id: debtor.user_id,
        to_user_id: creditor.user_id,
        amount_cents: Math.min(creditor.net_cents, -debtor.net_cents),
      }
    }
  }
  return { balances, suggestion }
}
