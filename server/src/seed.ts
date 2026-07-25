/**
 * Seed demo data so a fresh install has something to look at.
 * Run with: npm run seed   (wipes nothing unless the DB is empty; use --force to recreate)
 */
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { hashPassword } from './auth.js'
import { openDb } from './db.js'
import { id, now } from './lib/util.js'

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

const month = new Date().toISOString().slice(0, 7)
const day = (d: number) => `${month}-${String(d).padStart(2, '0')}`

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

const insertCategory = db.prepare(
  'INSERT INTO categories (id, household_id, name, emoji, scope, owner_user_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
)
const cat: Record<string, string> = {}
const sharedCats: [string, string, number][] = [
  ['Rent / Mortgage', '🏠', 210000],
  ['Groceries', '🛒', 70000],
  ['Utilities', '💡', 28000],
  ['Dining out', '🍽️', 35000],
  ['Travel', '✈️', 50000],
  ['Household', '🧺', 20000],
]
sharedCats.forEach(([name, emoji], index) => {
  const cid = id()
  cat[name] = cid
  insertCategory.run(cid, hhId, name, emoji, 'shared', null, index)
})
const personalCats: [string, string, string, number][] = [
  ['Fun money', '🎉', jake, 25000],
  ['Subscriptions', '📱', jake, 6500],
  ['Fun money', '🎉', sam, 25000],
  ['Studio supplies', '🎨', sam, 12000],
]
personalCats.forEach(([name, emoji, owner], index) => {
  const cid = id()
  cat[`${name}:${owner}`] = cid
  insertCategory.run(cid, hhId, name, emoji, 'personal', owner, 100 + index)
})

const insertAllocation = db.prepare(
  'INSERT INTO allocations (id, category_id, month, amount_cents) VALUES (?, ?, ?, ?)',
)
sharedCats.forEach(([name, , amount]) => insertAllocation.run(id(), cat[name], month, amount))
personalCats.forEach(([name, , owner, amount]) => insertAllocation.run(id(), cat[`${name}:${owner}`], month, amount))

const insertTx = db.prepare(
  `INSERT INTO transactions (id, household_id, kind, date, description, amount_cents, category_id, payer_user_id, trip_expense_id, notes, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
const insertSplit = db.prepare(
  'INSERT INTO transaction_splits (id, transaction_id, user_id, share_cents) VALUES (?, ?, ?, ?)',
)
function tx(
  date: string,
  description: string,
  amount: number,
  category: string | null,
  payer: string,
  splits: [string, number][],
  kind = 'expense',
): string {
  const txId = id()
  insertTx.run(txId, hhId, kind, date, description, amount, category, payer, null, null, now())
  for (const [userId, share] of splits) {
    insertSplit.run(id(), txId, userId, share)
  }
  return txId
}

tx(day(1), 'Rent', 210000, cat['Rent / Mortgage'], jake, [[jake, 118000], [sam, 92000]])
tx(day(2), 'Weekly groceries — Costco', 18432, cat['Groceries'], sam, [[jake, 9216], [sam, 9216]])
tx(day(5), 'Electric bill', 14210, cat['Utilities'], jake, [[jake, 7105], [sam, 7105]])
tx(day(6), 'Date night — Nopa', 12800, cat['Dining out'], sam, [[jake, 6400], [sam, 6400]])
tx(day(9), 'Weekly groceries — Trader Joe’s', 14655, cat['Groceries'], jake, [[jake, 7328], [sam, 7327]])
tx(day(11), 'Internet', 8000, cat['Utilities'], jake, [[jake, 4000], [sam, 4000]])
tx(day(12), 'New running shoes', 14500, cat[`Fun money:${jake}`], jake, [[jake, 14500]])
tx(day(14), 'Pottery class', 9500, cat[`Studio supplies:${sam}`], sam, [[sam, 9500]])
tx(day(15), 'Takeout — Thai', 6240, cat['Dining out'], jake, [[jake, 3120], [sam, 3120]])
tx(day(16), 'Weekly groceries', 16780, cat['Groceries'], sam, [[jake, 8390], [sam, 8390]])
tx(day(18), 'Cleaning supplies', 4325, cat['Household'], sam, [[jake, 2163], [sam, 2162]])
tx(day(20), 'Streaming bundle', 3299, cat[`Subscriptions:${jake}`], jake, [[jake, 3299]])
tx(day(21), 'Sam paid Jake', 25000, null, sam, [[jake, 25000]], 'settlement')

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

const year = Number(month.slice(0, 4))
const tripStart = `${year}-09-12`
const pch = id()
insertTrip.run(pch, hhId, 'Pacific Coast Highway', '🌊', 'planned', 'California', tripStart, `${year}-09-19`, null, 'Anniversary road trip — SF down to LA.', now())

const tripCats: [string, string, number][] = [
  ['Lodging', id(), 120000],
  ['Transport', id(), 40000],
  ['Food', id(), 60000],
  ['Activities', id(), 40000],
  ['Other', id(), 10000],
]
tripCats.forEach(([name, tcId, budget], index) => insertTripCat.run(tcId, pch, name, budget, index))
const tcId = (name: string) => tripCats.find(([n]) => n === name)![1]

const stops: [string, string, string, string, string | null][] = [
  ['San Francisco', 'San Francisco, CA', `${year}-09-12`, `${year}-09-13`, 'Hotel Zephyr'],
  ['Monterey & Carmel', 'Monterey, CA', `${year}-09-13`, `${year}-09-14`, 'Monterey Bay Inn'],
  ['Big Sur', 'Big Sur, CA', `${year}-09-14`, `${year}-09-16`, 'Glen Oaks cabins'],
  ['San Luis Obispo', 'San Luis Obispo, CA', `${year}-09-16`, `${year}-09-17`, 'Madonna Inn'],
  ['Santa Barbara', 'Santa Barbara, CA', `${year}-09-17`, `${year}-09-19`, 'The Wayfarer'],
]
const stopIds: string[] = []
stops.forEach(([name, location, arrive, depart, lodging], index) => {
  const sid = id()
  stopIds.push(sid)
  insertStop.run(sid, pch, index, name, location, arrive, depart, lodging, null)
})

insertTripExpense.run(id(), pch, tcId('Lodging'), stopIds[0], 'Hotel Zephyr (1 night)', 24500, 24500, `${month}-08`, jake, null, 'Booked early — refundable')
insertTripExpense.run(id(), pch, tcId('Lodging'), stopIds[2], 'Glen Oaks cabin (2 nights)', 52000, null, null, null, null, null)
insertTripExpense.run(id(), pch, tcId('Lodging'), stopIds[3], 'Madonna Inn (1 night)', 28900, null, null, null, null, null)
insertTripExpense.run(id(), pch, tcId('Transport'), null, 'Gas (estimate)', 22000, null, null, null, null, null)
insertTripExpense.run(id(), pch, tcId('Food'), null, 'Nice dinners x3', 36000, null, null, null, null, null)
insertTripExpense.run(id(), pch, tcId('Activities'), stopIds[1], 'Monterey Bay Aquarium', 12000, 11800, `${month}-15`, sam, null, null)
insertTripExpense.run(id(), pch, tcId('Activities'), stopIds[2], 'Kayaking tour', 15000, null, null, null, null, null)

insertTrip.run(id(), hhId, 'Tokyo food crawl', '🍜', 'idea', 'Tokyo, Japan', null, null, 600000, 'Someday: ramen, sushi breakfast at Toyosu, day trip to Hakone.', now())
insertTrip.run(id(), hhId, 'Banff & Lake Louise', '🏔️', 'idea', 'Alberta, Canada', null, null, 350000, null, now())

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

item(todoList, 'Book Glen Oaks cabin before prices go up', { assignee: jake, due: day(28) })
item(todoList, 'Renew car registration', { assignee: sam, due: day(30) })
item(todoList, 'Compare car insurance quotes', { assignee: jake })
item(groceryList, 'Chicken thighs')
item(groceryList, 'Basmati rice')
item(groceryList, 'Olive oil', { done: true })
item(groceryList, 'Coffee beans', { assignee: sam })
item(choresList, 'Deep clean the kitchen', { assignee: jake, due: day(26) })
item(choresList, 'Water the garden', { assignee: sam, done: true })
item(wishlist, 'Espresso machine', { amount: 65000, url: 'https://example.com/espresso', notes: 'Wait for a sale' })
item(wishlist, 'Weekend in Portland', { amount: 80000 })
item(wishlist, 'Standing desk for the office', { amount: 45000 })

const insertAccount = db.prepare(
  'INSERT INTO accounts (id, household_id, name, type, owner_user_id, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
)
const insertSnapshot = db.prepare(
  'INSERT INTO account_snapshots (id, account_id, date, balance_cents) VALUES (?, ?, ?, ?)',
)
function account(name: string, type: string, owner: string | null, sortIndex: number, balances: [string, number][]): void {
  const accountId = id()
  insertAccount.run(accountId, hhId, name, type, owner, sortIndex, now())
  for (const [date, balance] of balances) {
    insertSnapshot.run(id(), accountId, date, balance)
  }
}
const monthsBack = (n: number) => {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - n)
  return d.toISOString().slice(0, 8) + '15'
}
account('Joint checking', 'checking', null, 0, [
  [monthsBack(3), 412000], [monthsBack(2), 434500], [monthsBack(1), 401200], [monthsBack(0), 468900],
])
account('Emergency fund', 'savings', null, 1, [
  [monthsBack(3), 1150000], [monthsBack(2), 1200000], [monthsBack(1), 1250000], [monthsBack(0), 1300000],
])
account('Jake — 401(k)', 'retirement', jake, 2, [
  [monthsBack(3), 4820000], [monthsBack(2), 4975000], [monthsBack(1), 4890000], [monthsBack(0), 5120000],
])
account('Sam — Roth IRA', 'retirement', sam, 3, [
  [monthsBack(3), 2210000], [monthsBack(2), 2280000], [monthsBack(1), 2265000], [monthsBack(0), 2350000],
])
account('Brokerage (joint)', 'investment', null, 4, [
  [monthsBack(3), 1560000], [monthsBack(2), 1625000], [monthsBack(1), 1580000], [monthsBack(0), 1710000],
])
account('Visa — shared card', 'credit', null, 5, [
  [monthsBack(3), 184300], [monthsBack(2), 158900], [monthsBack(1), 210500], [monthsBack(0), 96200],
])
account('Car loan', 'loan', null, 6, [
  [monthsBack(3), 1420000], [monthsBack(2), 1385000], [monthsBack(1), 1350000], [monthsBack(0), 1315000],
])

const insertRecurring = db.prepare(
  `INSERT INTO recurring_transactions (id, household_id, description, amount_cents, category_id, payer_user_id, splits, cadence, day_of_month, next_date, active, notes, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
)
const nextMonthFirst = (() => {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() + 1, 1)
  return d.toISOString().slice(0, 10)
})()
insertRecurring.run(
  id(), hhId, 'Rent', 210000, cat['Rent / Mortgage'], jake,
  JSON.stringify([{ user_id: jake, share_cents: 118000 }, { user_id: sam, share_cents: 92000 }]),
  'monthly', 1, nextMonthFirst, 'Auto-posts on the 1st', now(),
)
insertRecurring.run(
  id(), hhId, 'Internet', 8000, cat['Utilities'], jake,
  JSON.stringify([{ user_id: jake, share_cents: 4000 }, { user_id: sam, share_cents: 4000 }]),
  'monthly', 11, nextMonthFirst.slice(0, 8) + '11', null, now(),
)

console.log('Seeded demo household:')
console.log('  jake@example.com / thefold')
console.log('  sam@example.com  / thefold')
console.log(`  DB: ${dbPath}`)
