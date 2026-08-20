import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SCHEMA_V1 = `
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  split_rule TEXT NOT NULL DEFAULT 'proportional',
  custom_split TEXT,
  calendar_token TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#8b5cf6',
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE income_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  cadence TEXT NOT NULL DEFAULT 'monthly',
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  emoji TEXT,
  scope TEXT NOT NULL DEFAULT 'shared',
  owner_user_id TEXT REFERENCES users(id),
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE allocations (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category_id, month)
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  kind TEXT NOT NULL DEFAULT 'expense',
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  payer_user_id TEXT NOT NULL REFERENCES users(id),
  trip_expense_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_transactions_household_date ON transactions(household_id, date);

CREATE TABLE transaction_splits (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  share_cents INTEGER NOT NULL
);
CREATE INDEX idx_splits_transaction ON transaction_splits(transaction_id);
CREATE INDEX idx_splits_user ON transaction_splits(user_id);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  emoji TEXT,
  status TEXT NOT NULL DEFAULT 'idea',
  location TEXT,
  start_date TEXT,
  end_date TEXT,
  total_budget_cents INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE trip_categories (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  budget_cents INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE trip_stops (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  location TEXT,
  arrive_date TEXT,
  depart_date TEXT,
  lodging TEXT,
  notes TEXT
);

CREATE TABLE trip_expenses (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  trip_category_id TEXT REFERENCES trip_categories(id) ON DELETE SET NULL,
  stop_id TEXT REFERENCES trip_stops(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  planned_cents INTEGER NOT NULL DEFAULT 0,
  actual_cents INTEGER,
  date TEXT,
  payer_user_id TEXT REFERENCES users(id),
  posted_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  notes TEXT
);

CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'todo',
  emoji TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  notes TEXT,
  url TEXT,
  amount_cents INTEGER,
  assignee_user_id TEXT REFERENCES users(id),
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE settings (
  household_id TEXT NOT NULL REFERENCES households(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (household_id, key)
);
`

const SCHEMA_V2 = `
ALTER TABLE transactions ADD COLUMN recurring_id TEXT;
ALTER TABLE transactions ADD COLUMN import_hash TEXT;
CREATE INDEX idx_tx_import ON transactions(household_id, import_hash);

CREATE TABLE recurring_transactions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  payer_user_id TEXT NOT NULL REFERENCES users(id),
  splits TEXT NOT NULL,
  cadence TEXT NOT NULL DEFAULT 'monthly',
  day_of_month INTEGER NOT NULL DEFAULT 1,
  next_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE import_rules (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  match_text TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  split_mode TEXT NOT NULL DEFAULT 'equal',
  created_at TEXT NOT NULL
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'checking',
  owner_user_id TEXT REFERENCES users(id),
  archived INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE account_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  balance_cents INTEGER NOT NULL,
  UNIQUE (account_id, date)
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
`

const SCHEMA_V3 = `
CREATE TABLE category_groups (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  emoji TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE categories ADD COLUMN group_id TEXT REFERENCES category_groups(id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN rollover INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN target_cents INTEGER;
ALTER TABLE categories ADD COLUMN target_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE categories ADD COLUMN target_date TEXT;
ALTER TABLE categories ADD COLUMN notes TEXT;

CREATE TABLE month_incomes (
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  month TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  PRIMARY KEY (household_id, user_id, month)
);
`

/**
 * Line items: one purchase can be split across several categories (the $300
 * Costco run that is $100 groceries and $200 household). Lines are the source
 * of truth for category spending; transactions.category_id stays as a
 * convenience mirror of the single-line case.
 */
const SCHEMA_V4 = `
CREATE TABLE transaction_lines (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL,
  note TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_lines_transaction ON transaction_lines(transaction_id);
CREATE INDEX idx_lines_category ON transaction_lines(category_id);

INSERT INTO transaction_lines (id, transaction_id, category_id, amount_cents, note, sort)
SELECT lower(hex(randomblob(16))), id, category_id, amount_cents, NULL, 0 FROM transactions;
`

/**
 * Solo accounts + invite linking, and paycheck-aware income:
 * - invites let one person's solo budget merge into their partner's household
 * - income sources can carry a gross amount + deductions (taxes, 401k, …);
 *   amount_cents remains the take-home (net) figure
 * - split_basis decides whether income-proportional splitting uses net or gross
 */
const SCHEMA_V5 = `
ALTER TABLE households ADD COLUMN split_basis TEXT NOT NULL DEFAULT 'net';
ALTER TABLE income_sources ADD COLUMN gross_cents INTEGER;
ALTER TABLE income_sources ADD COLUMN deductions TEXT;

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by_user_id TEXT REFERENCES users(id),
  used_at TEXT
);
`

/**
 * Budgeting methods. The envelope machinery stays the engine underneath;
 * budget_method changes how the month is framed (50/30/20, pay-yourself-first,
 * plain tracking), and categories carry a need/want/save bucket to feed those
 * views. Existing categories are backfilled with sensible buckets.
 */
const SCHEMA_V6 = `
ALTER TABLE households ADD COLUMN budget_method TEXT NOT NULL DEFAULT 'envelope';
ALTER TABLE households ADD COLUMN method_config TEXT;
ALTER TABLE categories ADD COLUMN bucket TEXT;

UPDATE categories SET bucket = 'save' WHERE scope = 'shared' AND name IN ('Travel', 'Emergency fund');
UPDATE categories SET bucket = 'want' WHERE scope = 'shared' AND name IN ('Dining out', 'Gifts');
UPDATE categories SET bucket = 'want' WHERE scope = 'personal';
UPDATE categories SET bucket = 'need' WHERE bucket IS NULL;
`

/**
 * Statement imports v2: every import is a batch tied to the account the
 * statement came from, so it can be reviewed and undone as a unit, and
 * transactions know which account they hit.
 */
const SCHEMA_V7 = `
CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  filename TEXT,
  created_at TEXT NOT NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE transactions ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN import_batch_id TEXT REFERENCES import_batches(id) ON DELETE SET NULL;
CREATE INDEX idx_tx_account ON transactions(household_id, account_id);
`

/**
 * Merchants: named places with an optional website domain (which is where the
 * logo comes from). Transactions can point at one for logos, search, and
 * "usual category" suggestions.
 */
const SCHEMA_V8 = `
CREATE TABLE merchants (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  domain TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE transactions ADD COLUMN merchant_id TEXT REFERENCES merchants(id) ON DELETE SET NULL;
CREATE INDEX idx_tx_merchant ON transactions(household_id, merchant_id);

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
UPDATE users SET is_admin = 1 WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1);

CREATE TABLE instance_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

// v9 — reconciliation: transactions carry a cleared flag ("has this hit the bank"),
// imported rows arrive cleared (the bank statement is the source), manual entries start pending.
const SCHEMA_V9 = `
ALTER TABLE transactions ADD COLUMN cleared INTEGER NOT NULL DEFAULT 0;
UPDATE transactions SET cleared = 1 WHERE import_hash IS NOT NULL;
`

// v10 — budget defaults: allocations remember whether a human set them or the
// household's default budget materialized them, so a new default can refresh
// untouched months without ever clobbering hand-set numbers.
const SCHEMA_V10 = `
ALTER TABLE allocations ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
`

const MIGRATIONS: { version: number; sql: string }[] = [
  { version: 1, sql: SCHEMA_V1 },
  { version: 2, sql: SCHEMA_V2 },
  { version: 3, sql: SCHEMA_V3 },
  { version: 4, sql: SCHEMA_V4 },
  { version: 5, sql: SCHEMA_V5 },
  { version: 6, sql: SCHEMA_V6 },
  { version: 7, sql: SCHEMA_V7 },
  { version: 8, sql: SCHEMA_V8 },
  { version: 9, sql: SCHEMA_V9 },
  { version: 10, sql: SCHEMA_V10 },
]

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true })
  }
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const row = db.prepare('SELECT MAX(version) AS v FROM _migrations').get() as { v: number | null }
  const current = row?.v ?? 0
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      )
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}
