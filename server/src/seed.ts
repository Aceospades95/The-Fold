/**
 * Seed demo data so a fresh install has something to look at: four months of
 * budgets and spending, sinking funds mid-flight, a planned trip, and lists.
 * Run with: npm run seed   (use --force to wipe and reseed)
 */
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { hashPassword } from './auth.js'
import { openDb } from './db.js'
import { id, now, shiftMonth } from './lib/util.js'

const here = dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.FOLD_DB ?? resolve(here, '../../data/the-fold.db')
const force = process.argv.includes('--force')

if (force) {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${dbPath}${suffix}`, { force: true })
  }
}

const db = openDb(dbPath)
const existing = (db.prepare('SELECT COUNT(*) AS c FROM households').get() as { c: number }).c
if (existing > 0) {
  console.log('Database already has data — skipping seed. Use --force to wipe and reseed.')
  process.exit(0)
}

const thisMonth = new Date().toISOString().slice(0, 7)
const months = [3, 2, 1, 0].map((back) => shiftMonth(thisMonth, -back))
const [m3, m2, m1, m0] = months
const day = (month: string, d: number) => `${month}-${String(d).padStart(2, '0')}`

const hhId = id()
db.prepare(
  'INSERT INTO households (id, name, split_rule, custom_split, calendar_token, created_at) VALUES (?, ?, ?, ?, ?, ?)',
).run(hhId, 'Jake & Sam', 'proportional', null, randomBytes(16).toString('hex'), now())

const jake = id()
const sam = id()
const insertUser = db.prepare(
  'INSERT INTO users (id, household_id, name, email, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
)
insertUser.run(jake, hhId, 'Jake', 'jake@example.com', hashPassword('thefold'), '#8b5cf6', now())
insertUser.run(sam, hhId, 'Sam', 'sam@example.com', hashPassword('thefold'), '#10b981', now())

const insertIncome = db.prepare(
  'INSERT INTO income_sources (id, user_id, name, amount_cents, cadence, notes) VALUES (?, ?, ?, ?, ?, ?)',
)
insertIncome.run(id(), jake, 'Salary', 270000, 'biweekly', null)
insertIncome.run(id(), sam, 'Salary', 205000, 'biweekly', null)
insertIncome.run(id(), sam, 'Etsy shop', 15000, 'monthly', 'Averages out month to month')

// --- category groups -------------------------------------------------------
const groups: Record<string, string> = {}
const insertGroup = db.prepare(
  'INSERT INTO category_groups (id, household_id, name, emoji, sort) VALUES (?, ?, ?, ?, ?)',
)
;[
  ['home', 'Home', '🏠'],
  ['food', 'Food', '🍽️'],
  ['transport', 'Getting around', '🚗'],
  ['life', 'Life & health', '💗'],
  ['goals', 'Goals & sinking funds', '🎯'],
].forEach(([key, name, emoji], index) => {
  const groupId = id()
  groups[key] = groupId
  insertGroup.run(groupId, hhId, name, emoji, index)
})

// --- categories ------------------------------------------------------------
const cat: Record<string, string> = {}
const insertCategory = db.prepare(
  `INSERT INTO categories (id, household_id, name, emoji, scope, owner_user_id, group_id, rollover, target_cents, target_type, target_date, notes, sort)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)

interface SeedCategory {
  name: string
  emoji: string
  group: string
  monthly: number
  rollover?: 0 | 1
  target?: { type: 'monthly' | 'by_date'; cents: number; date?: string }
}

const year = Number(thisMonth.slice(0, 4))
const sharedCategories: SeedCategory[] = [
  { name: 'Rent / Mortgage', emoji: '🏠', group: 'home', monthly: 210000, target: { type: 'monthly', cents: 210000 } },
  { name: 'Utilities', emoji: '💡', group: 'home', monthly: 22000 },
  { name: 'Internet & phone', emoji: '📶', group: 'home', monthly: 15000, target: { type: 'monthly', cents: 15000 } },
  { name: 'Household', emoji: '🧺', group: 'home', monthly: 12000 },
  { name: 'Home repairs', emoji: '🔧', group: 'home', monthly: 10000, rollover: 1 },
  { name: 'Groceries', emoji: '🛒', group: 'food', monthly: 70000, target: { type: 'monthly', cents: 70000 } },
  { name: 'Dining out', emoji: '🍜', group: 'food', monthly: 30000 },
  { name: 'Gas', emoji: '⛽', group: 'transport', monthly: 18000 },
  {
    name: 'Car insurance',
    emoji: '🛡️',
    group: 'transport',
    monthly: 14000,
    rollover: 1,
    target: { type: 'by_date', cents: 84000, date: `${year}-12-01` },
  },
  { name: 'Car maintenance', emoji: '🔩', group: 'transport', monthly: 8000, rollover: 1 },
  { name: 'Health', emoji: '🩺', group: 'life', monthly: 12000 },
  { name: 'Gifts', emoji: '🎁', group: 'life', monthly: 8000, rollover: 1 },
  {
    name: 'Travel',
    emoji: '✈️',
    group: 'goals',
    monthly: 60000,
    rollover: 1,
    target: { type: 'by_date', cents: 270000, date: `${year}-09-12` },
  },
  {
    name: 'Emergency fund',
    emoji: '🏦',
    group: 'goals',
    monthly: 40000,
    rollover: 1,
    target: { type: 'monthly', cents: 40000 },
  },
]

sharedCategories.forEach((entry, index) => {
  const categoryId = id()
  cat[entry.name] = categoryId
  insertCategory.run(
    categoryId,
    hhId,
    entry.name,
    entry.emoji,
    'shared',
    null,
    groups[entry.group],
    entry.rollover ?? 0,
    entry.target?.cents ?? null,
    entry.target?.type ?? 'none',
    entry.target?.date ?? null,
    null,
    index,
  )
})

const personalCategories: { name: string; emoji: string; owner: string; monthly: number; rollover?: 0 | 1 }[] = [
  { name: 'Fun money', emoji: '🎉', owner: jake, monthly: 25000 },
  { name: 'Subscriptions', emoji: '📱', owner: jake, monthly: 6500 },
  { name: 'Bike fund', emoji: '🚲', owner: jake, monthly: 10000, rollover: 1 },
  { name: 'Fun money', emoji: '🎉', owner: sam, monthly: 25000 },
  { name: 'Studio supplies', emoji: '🎨', owner: sam, monthly: 12000 },
]
personalCategories.forEach((entry, index) => {
  const categoryId = id()
  cat[`${entry.name}:${entry.owner}`] = categoryId
  insertCategory.run(
    categoryId,
    hhId,
    entry.name,
    entry.emoji,
    'personal',
    entry.owner,
    null,
    entry.rollover ?? 0,
    null,
    'none',
    null,
    null,
    100 + index,
  )
})

// --- allocations: same plan every month ------------------------------------
const insertAllocation = db.prepare(
  'INSERT INTO allocations (id, category_id, month, amount_cents) VALUES (?, ?, ?, ?)',
)
for (const month of months) {
  sharedCategories.forEach((entry) => insertAllocation.run(id(), cat[entry.name], month, entry.monthly))
  personalCategories.forEach((entry) =>
    insertAllocation.run(id(), cat[`${entry.name}:${entry.owner}`], month, entry.monthly),
  )
}

// --- transactions ----------------------------------------------------------
const insertTx = db.prepare(
  `INSERT INTO transactions (id, household_id, kind, date, description, amount_cents, category_id, payer_user_id, trip_expense_id, recurring_id, import_hash, notes, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
)
const insertSplit = db.prepare(
  'INSERT INTO transaction_splits (id, transaction_id, user_id, share_cents) VALUES (?, ?, ?, ?)',
)

const insertLine = db.prepare(
  'INSERT INTO transaction_lines (id, transaction_id, category_id, amount_cents, note, sort) VALUES (?, ?, ?, ?, NULL, ?)',
)

function tx(
  date: string,
  description: string,
  amount: number,
  category: string | null,
  payer: string,
  splits: [string, number][],
  kind = 'expense',
): void {
  const txId = id()
  insertTx.run(txId, hhId, kind, date, description, amount, category, payer, now())
  for (const [userId, share] of splits) insertSplit.run(id(), txId, userId, share)
  insertLine.run(id(), txId, category, amount, 0)
}

/** One purchase spread across several categories, split by who each slice belongs to. */
function txSplit(
  date: string,
  description: string,
  payer: string,
  lines: { category: string | null; amount: number; owner?: string }[],
): void {
  const amount = lines.reduce((sum, line) => sum + line.amount, 0)
  const owed = new Map<string, number>([
    [jake, 0],
    [sam, 0],
  ])
  for (const line of lines) {
    if (line.owner) {
      owed.set(line.owner, owed.get(line.owner)! + line.amount)
    } else {
      for (const [userId, share] of byIncome(line.amount)) owed.set(userId, owed.get(userId)! + share)
    }
  }
  const txId = id()
  insertTx.run(txId, hhId, 'expense', date, description, amount, lines.length === 1 ? lines[0].category : null, payer, now())
  for (const [userId, share] of owed.entries()) {
    if (share > 0) insertSplit.run(id(), txId, userId, share)
  }
  lines.forEach((line, index) => insertLine.run(id(), txId, line.category, line.amount, index))
}

const half = (amount: number): [string, number][] => [
  [jake, Math.ceil(amount / 2)],
  [sam, Math.floor(amount / 2)],
]
const byIncome = (amount: number): [string, number][] => {
  const jakeShare = Math.round(amount * 0.56)
  return [
    [jake, jakeShare],
    [sam, amount - jakeShare],
  ]
}

/** A typical month of household spending, jittered per month. */
function seedMonth(month: string, jitter: number, options: { partial?: boolean } = {}): void {
  const scale = (base: number) => Math.round(base * (1 + jitter))
  tx(day(month, 1), 'Rent', 210000, cat['Rent / Mortgage'], jake, byIncome(210000))
  tx(day(month, 5), 'Electric bill', scale(9800), cat['Utilities'], jake, half(scale(9800)))
  tx(day(month, 6), 'Water & trash', 5400, cat['Utilities'], sam, half(5400))
  tx(day(month, 8), 'Internet', 8000, cat['Internet & phone'], jake, half(8000))
  tx(day(month, 8), 'Phone plan', 7000, cat['Internet & phone'], sam, half(7000))
  tx(day(month, 2), 'Costco run', scale(18432), cat['Groceries'], sam, half(scale(18432)))
  tx(day(month, 9), 'Trader Joe’s', scale(14655), cat['Groceries'], jake, half(scale(14655)))
  tx(day(month, 16), 'Weekly groceries', scale(16780), cat['Groceries'], sam, half(scale(16780)))
  if (!options.partial) {
    tx(day(month, 23), 'Weekly groceries', scale(15990), cat['Groceries'], jake, half(scale(15990)))
  }
  tx(day(month, 6), 'Date night — Nopa', scale(12800), cat['Dining out'], sam, half(scale(12800)))
  tx(day(month, 15), 'Takeout — Thai', scale(6240), cat['Dining out'], jake, half(scale(6240)))
  tx(day(month, 12), 'Gas', scale(6100), cat['Gas'], jake, half(scale(6100)))
  tx(day(month, 26 - (options.partial ? 8 : 0)), 'Gas', scale(5800), cat['Gas'], sam, half(scale(5800)))
  tx(day(month, 18), 'Cleaning supplies', scale(4325), cat['Household'], sam, half(scale(4325)))
  tx(day(month, 20), 'Streaming bundle', 3299, cat[`Subscriptions:${jake}`], jake, [[jake, 3299]])
  tx(day(month, 14), 'Pottery class', scale(9500), cat[`Studio supplies:${sam}`], sam, [[sam, 9500]])
  tx(day(month, 11), 'Climbing gym', scale(8500), cat[`Fun money:${jake}`], jake, [[jake, scale(8500)]])
  tx(day(month, 17), 'Concert tickets', scale(11000), cat[`Fun money:${sam}`], sam, [[sam, scale(11000)]])
}

seedMonth(m3, 0.04)
seedMonth(m2, -0.02)
seedMonth(m1, 0.07)
seedMonth(m0, 0, { partial: true })

// Occasional / sinking-fund spending that makes rollover visible.
tx(day(m2, 21), 'Birthday gift — Mom', 12000, cat['Gifts'], sam, half(12000))
tx(day(m1, 9), 'New brake pads', 24500, cat['Car maintenance'], jake, half(24500))
tx(day(m1, 27), 'Dentist', 18000, cat['Health'], sam, half(18000))
tx(day(m0, 12), 'Running shoes', 14500, cat[`Fun money:${jake}`], jake, [[jake, 14500]])
tx(day(m0, 19), 'Leaky faucet fix', 16500, cat['Home repairs'], jake, half(16500))
tx(day(m1, 21), 'Sam paid Jake', 25000, null, sam, [[jake, 25000]], 'settlement')

// One receipt, several envelopes — groceries + household + Jake's own fun money.
txSplit(day(m0, 10), 'Costco run — mixed cart', jake, [
  { category: cat['Groceries'], amount: 10400 },
  { category: cat['Household'], amount: 7600 },
  { category: cat[`Fun money:${jake}`], amount: 6000, owner: jake },
])
txSplit(day(m1, 13), 'Target — house + gifts', sam, [
  { category: cat['Household'], amount: 5400 },
  { category: cat['Gifts'], amount: 4200 },
])

// Freshly imported and not yet filed — these show up in the classify queue.
tx(day(m0, 22), 'AMZN MKTP US*2A45BX9', 6742, null, jake, half(6742))
tx(day(m0, 24), 'SQ *BLUE BOTTLE COFFEE', 1850, null, sam, half(1850))
tx(day(m0, 25), 'POS DEBIT 4412 TARGET', 8934, null, jake, half(8934))

// --- trips -----------------------------------------------------------------
const insertTrip = db.prepare(
  `INSERT INTO trips (id, household_id, name, emoji, status, location, start_date, end_date, total_budget_cents, notes, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
const insertTripCat = db.prepare(
  'INSERT INTO trip_categories (id, trip_id, name, budget_cents, sort) VALUES (?, ?, ?, ?, ?)',
)
const insertStop = db.prepare(
  `INSERT INTO trip_stops (id, trip_id, sort, name, location, arrive_date, depart_date, lodging, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
const insertTripExpense = db.prepare(
  `INSERT INTO trip_expenses (id, trip_id, trip_category_id, stop_id, name, planned_cents, actual_cents, date, payer_user_id, posted_transaction_id, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)

const pch = id()
insertTrip.run(pch, hhId, 'Pacific Coast Highway', '🌊', 'planned', 'California', `${year}-09-12`, `${year}-09-19`, null, 'Anniversary road trip — SF down to LA. Funded by the Travel envelope.', now())

const tripCats: [string, string, number][] = [
  ['Lodging', id(), 120000],
  ['Transport', id(), 40000],
  ['Food', id(), 60000],
  ['Activities', id(), 40000],
  ['Other', id(), 10000],
]
tripCats.forEach(([name, tcId, budget], index) => insertTripCat.run(tcId, pch, name, budget, index))
const tcId = (name: string) => tripCats.find(([n]) => n === name)![1]

const stops: [string, string, string, string, string][] = [
  ['San Francisco', 'San Francisco, CA', `${year}-09-12`, `${year}-09-13`, 'Hotel Zephyr'],
  ['Monterey & Carmel', 'Monterey, CA', `${year}-09-13`, `${year}-09-14`, 'Monterey Bay Inn'],
  ['Big Sur', 'Big Sur, CA', `${year}-09-14`, `${year}-09-16`, 'Glen Oaks cabins'],
  ['San Luis Obispo', 'San Luis Obispo, CA', `${year}-09-16`, `${year}-09-17`, 'Madonna Inn'],
  ['Santa Barbara', 'Santa Barbara, CA', `${year}-09-17`, `${year}-09-19`, 'The Wayfarer'],
]
const stopIds: string[] = []
stops.forEach(([name, location, arrive, depart, lodging], index) => {
  const stopId = id()
  stopIds.push(stopId)
  insertStop.run(stopId, pch, index, name, location, arrive, depart, lodging, null)
})

insertTripExpense.run(id(), pch, tcId('Lodging'), stopIds[0], 'Hotel Zephyr (1 night)', 24500, 24500, day(m1, 8), jake, null, 'Booked early — refundable')
insertTripExpense.run(id(), pch, tcId('Lodging'), stopIds[2], 'Glen Oaks cabin (2 nights)', 52000, null, null, null, null, null)
insertTripExpense.run(id(), pch, tcId('Lodging'), stopIds[3], 'Madonna Inn (1 night)', 28900, null, null, null, null, null)
insertTripExpense.run(id(), pch, tcId('Transport'), null, 'Gas (estimate)', 22000, null, null, null, null, null)
insertTripExpense.run(id(), pch, tcId('Food'), null, 'Nice dinners x3', 36000, null, null, null, null, null)
insertTripExpense.run(id(), pch, tcId('Activities'), stopIds[1], 'Monterey Bay Aquarium', 12000, 11800, day(m0, 15), sam, null, null)
insertTripExpense.run(id(), pch, tcId('Activities'), stopIds[2], 'Kayaking tour', 15000, null, null, null, null, null)

insertTrip.run(id(), hhId, 'Tokyo food crawl', '🍜', 'idea', 'Tokyo, Japan', null, null, 600000, 'Someday: ramen, sushi breakfast at Toyosu, day trip to Hakone.', now())
insertTrip.run(id(), hhId, 'Banff & Lake Louise', '🏔️', 'idea', 'Alberta, Canada', null, null, 350000, null, now())

// --- lists -----------------------------------------------------------------
const insertList = db.prepare('INSERT INTO lists (id, household_id, name, type, emoji, sort) VALUES (?, ?, ?, ?, ?, ?)')
const insertItem = db.prepare(
  `INSERT INTO list_items (id, list_id, text, notes, url, amount_cents, assignee_user_id, due_date, done, sort, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
const todoList = id()
const groceryList = id()
const choresList = id()
const wishlist = id()
insertList.run(todoList, hhId, 'To-dos', 'todo', '✅', 0)
insertList.run(groceryList, hhId, 'Groceries', 'grocery', '🛒', 1)
insertList.run(choresList, hhId, 'Chores', 'chores', '🧹', 2)
insertList.run(wishlist, hhId, 'Wishlist', 'wishlist', '🌟', 3)

let sort = 0
const item = (
  list: string,
  text: string,
  extra: { assignee?: string; due?: string; done?: boolean; amount?: number; url?: string; notes?: string } = {},
) =>
  insertItem.run(
    id(),
    list,
    text,
    extra.notes ?? null,
    extra.url ?? null,
    extra.amount ?? null,
    extra.assignee ?? null,
    extra.due ?? null,
    extra.done ? 1 : 0,
    sort++,
    now(),
  )

item(todoList, 'Book Glen Oaks cabin before prices go up', { assignee: jake, due: day(m0, 28) })
item(todoList, 'Renew car registration', { assignee: sam, due: day(m0, 30) })
item(todoList, 'Compare car insurance quotes', { assignee: jake })
item(groceryList, 'Chicken thighs')
item(groceryList, 'Basmati rice')
item(groceryList, 'Olive oil', { done: true })
item(groceryList, 'Coffee beans', { assignee: sam })
item(choresList, 'Deep clean the kitchen', { assignee: jake, due: day(m0, 26) })
item(choresList, 'Water the garden', { assignee: sam, done: true })
item(wishlist, 'Espresso machine', { amount: 65000, url: 'https://example.com/espresso', notes: 'Wait for a sale' })
item(wishlist, 'Weekend in Portland', { amount: 80000 })
item(wishlist, 'Standing desk for the office', { amount: 45000 })

// --- accounts & net worth --------------------------------------------------
const insertAccount = db.prepare(
  'INSERT INTO accounts (id, household_id, name, type, owner_user_id, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
)
const insertSnapshot = db.prepare(
  'INSERT INTO account_snapshots (id, account_id, date, balance_cents) VALUES (?, ?, ?, ?)',
)
function account(name: string, type: string, owner: string | null, sortIndex: number, balances: number[]): void {
  const accountId = id()
  insertAccount.run(accountId, hhId, name, type, owner, sortIndex, now())
  months.forEach((month, index) => insertSnapshot.run(id(), accountId, day(month, 15), balances[index]))
}
account('Joint checking', 'checking', null, 0, [412000, 434500, 401200, 468900])
account('Emergency fund', 'savings', null, 1, [1150000, 1200000, 1250000, 1300000])
account('Jake — 401(k)', 'retirement', jake, 2, [4820000, 4975000, 4890000, 5120000])
account('Sam — Roth IRA', 'retirement', sam, 3, [2210000, 2280000, 2265000, 2350000])
account('Brokerage (joint)', 'investment', null, 4, [1560000, 1625000, 1580000, 1710000])
account('Visa — shared card', 'credit', null, 5, [184300, 158900, 210500, 96200])
account('Car loan', 'loan', null, 6, [1420000, 1385000, 1350000, 1315000])

// --- recurring -------------------------------------------------------------
const insertRecurring = db.prepare(
  `INSERT INTO recurring_transactions (id, household_id, description, amount_cents, category_id, payer_user_id, splits, cadence, day_of_month, next_date, active, notes, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
)
const nextMonth = shiftMonth(thisMonth, 1)
insertRecurring.run(
  id(), hhId, 'Rent', 210000, cat['Rent / Mortgage'], jake,
  JSON.stringify(byIncome(210000).map(([user_id, share_cents]) => ({ user_id, share_cents }))),
  'monthly', 1, day(nextMonth, 1), 'Auto-posts on the 1st', now(),
)
insertRecurring.run(
  id(), hhId, 'Internet', 8000, cat['Internet & phone'], jake,
  JSON.stringify([{ user_id: jake, share_cents: 4000 }, { user_id: sam, share_cents: 4000 }]),
  'monthly', 8, day(nextMonth, 8), null, now(),
)

console.log('Seeded demo household with four months of budget history:')
console.log('  jake@example.com / thefold')
console.log('  sam@example.com  / thefold')
console.log(`  DB: ${dbPath}`)
