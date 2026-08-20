import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { HttpError, id, today } from '../lib/util.js'

/** Everything the household owns, keyed by table — the "my data is mine" export. */
function fullExport(app: FastifyInstance, householdId: string): Record<string, unknown> {
  const db = app.db
  const one = (sql: string) => db.prepare(sql).get(householdId)
  const many = (sql: string) => db.prepare(sql).all(householdId)

  const users = (many('SELECT * FROM users WHERE household_id = ?') as Record<string, unknown>[]).map(
    ({ password_hash: _ph, ...rest }) => rest,
  )

  return {
    exported_at: new Date().toISOString(),
    app: 'the-fold',
    household: one('SELECT * FROM households WHERE id = ?'),
    users,
    income_sources: many(
      'SELECT s.* FROM income_sources s JOIN users u ON u.id = s.user_id WHERE u.household_id = ?',
    ),
    category_groups: many('SELECT * FROM category_groups WHERE household_id = ?'),
    categories: many('SELECT * FROM categories WHERE household_id = ?'),
    allocations: many(
      'SELECT a.* FROM allocations a JOIN categories c ON c.id = a.category_id WHERE c.household_id = ?',
    ),
    month_incomes: many('SELECT * FROM month_incomes WHERE household_id = ?'),
    merchants: many('SELECT * FROM merchants WHERE household_id = ?'),
    accounts: many('SELECT * FROM accounts WHERE household_id = ?'),
    account_snapshots: many(
      'SELECT s.* FROM account_snapshots s JOIN accounts a ON a.id = s.account_id WHERE a.household_id = ?',
    ),
    transactions: many('SELECT * FROM transactions WHERE household_id = ?'),
    transaction_splits: many(
      'SELECT ts.* FROM transaction_splits ts JOIN transactions t ON t.id = ts.transaction_id WHERE t.household_id = ?',
    ),
    transaction_lines: many(
      'SELECT tl.* FROM transaction_lines tl JOIN transactions t ON t.id = tl.transaction_id WHERE t.household_id = ?',
    ),
    recurring_transactions: many('SELECT * FROM recurring_transactions WHERE household_id = ?'),
    import_rules: many('SELECT * FROM import_rules WHERE household_id = ?'),
    import_batches: many('SELECT * FROM import_batches WHERE household_id = ?'),
    trips: many('SELECT * FROM trips WHERE household_id = ?'),
    trip_categories: many(
      'SELECT tc.* FROM trip_categories tc JOIN trips t ON t.id = tc.trip_id WHERE t.household_id = ?',
    ),
    trip_stops: many('SELECT ts.* FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id WHERE t.household_id = ?'),
    trip_expenses: many(
      'SELECT te.* FROM trip_expenses te JOIN trips t ON t.id = te.trip_id WHERE t.household_id = ?',
    ),
    lists: many('SELECT * FROM lists WHERE household_id = ?'),
    list_items: many('SELECT li.* FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.household_id = ?'),
    // The plan sandbox and its scenarios live in the settings store — they're
    // core data now, so the export carries them (secrets like webhook URLs stay out).
    plan: settingValue(app, householdId, 'plan'),
    plan_scenarios: settingValue(app, householdId, 'plan_scenarios') ?? [],
    budget_defaults: settingValue(app, householdId, 'budget_defaults') ?? [],
    import_profiles: db
      .prepare(`SELECT key, value FROM settings WHERE household_id = ? AND key LIKE 'import_profile:%'`)
      .all(householdId)
      .map((row) => {
        const r = row as { key: string; value: string }
        return { account_id: r.key.slice('import_profile:'.length), profile: JSON.parse(r.value) as unknown }
      }),
  }
}

function settingValue(app: FastifyInstance, householdId: string, key: string): unknown {
  const row = app.db
    .prepare('SELECT value FROM settings WHERE household_id = ? AND key = ?')
    .get(householdId, key) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as unknown) : null
}

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function transactionsCsv(app: FastifyInstance, householdId: string): string {
  const rows = app.db
    .prepare(
      `SELECT t.date, t.description, t.kind, t.amount_cents, t.cleared, t.notes,
              m.name AS store, a.name AS account, u.name AS paid_by, t.id AS tx_id
       FROM transactions t
       LEFT JOIN merchants m ON m.id = t.merchant_id
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN users u ON u.id = t.payer_user_id
       WHERE t.household_id = ?
       ORDER BY t.date, t.created_at`,
    )
    .all(householdId) as {
    date: string
    description: string
    kind: string
    amount_cents: number
    cleared: number
    notes: string | null
    store: string | null
    account: string | null
    paid_by: string | null
    tx_id: string
  }[]
  const lines = app.db
    .prepare(
      `SELECT tl.transaction_id, tl.amount_cents, c.name
       FROM transaction_lines tl
       JOIN transactions t ON t.id = tl.transaction_id
       LEFT JOIN categories c ON c.id = tl.category_id
       WHERE t.household_id = ? ORDER BY tl.sort`,
    )
    .all(householdId) as { transaction_id: string; amount_cents: number; name: string | null }[]
  const splits = app.db
    .prepare(
      `SELECT ts.transaction_id, ts.share_cents, u.name
       FROM transaction_splits ts
       JOIN transactions t ON t.id = ts.transaction_id
       LEFT JOIN users u ON u.id = ts.user_id
       WHERE t.household_id = ?`,
    )
    .all(householdId) as { transaction_id: string; share_cents: number; name: string | null }[]

  const money = (cents: number) => (cents / 100).toFixed(2)
  const header = 'date,description,store,kind,amount,categories,split,account,paid_by,cleared,notes'
  const body = rows.map((row) => {
    const myLines = lines.filter((l) => l.transaction_id === row.tx_id)
    const categories =
      myLines.length === 1
        ? (myLines[0].name ?? '')
        : myLines.map((l) => `${l.name ?? 'Uncategorized'} ${money(l.amount_cents)}`).join('; ')
    const split = splits
      .filter((s) => s.transaction_id === row.tx_id)
      .map((s) => `${s.name ?? '?'} ${money(s.share_cents)}`)
      .join('; ')
    return [
      row.date,
      csvCell(row.description),
      csvCell(row.store ?? ''),
      row.kind,
      money(row.amount_cents),
      csvCell(categories),
      csvCell(split),
      csvCell(row.account ?? ''),
      csvCell(row.paid_by ?? ''),
      row.cleared ? 'yes' : 'no',
      csvCell(row.notes ?? ''),
    ].join(',')
  })
  return [header, ...body].join('\n') + '\n'
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/export/full.json', async (req, reply) => {
    reply.header('content-disposition', `attachment; filename="the-fold-export-${today()}.json"`)
    return fullExport(app, req.user.household_id)
  })

  app.get('/export/transactions.csv', async (req, reply) => {
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="the-fold-transactions-${today()}.csv"`)
    return transactionsCsv(app, req.user.household_id)
  })

  /** A consistent copy of the whole SQLite file — the real backup. Admin only: it spans the instance. */
  app.get('/export/backup.sqlite', async (req, reply) => {
    if (!req.user.is_admin) throw new HttpError(403, 'Only the server admin can download the database backup.')
    const path = join(tmpdir(), `fold-backup-${id()}.sqlite`)
    try {
      app.db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`)
      const buffer = readFileSync(path)
      reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', `attachment; filename="the-fold-backup-${today()}.sqlite"`)
      return reply.send(buffer)
    } finally {
      rmSync(path, { force: true })
    }
  })
}
