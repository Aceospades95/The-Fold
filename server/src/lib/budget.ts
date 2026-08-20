import type { DatabaseSync } from 'node:sqlite'
import type {
  BudgetBucketRow,
  BudgetCategoryRow,
  BudgetGroupRow,
  BudgetMethod,
  BudgetResponse,
  Category,
  CategoryDetailResponse,
  CategoryGroup,
  MethodConfig,
  QuickFillStrategy,
  SpendBucket,
  SplitRule,
  TrendsResponse,
} from '@fold/shared'
import { BUCKET_LABELS, splitByWeights } from '@fold/shared'
import { getMembers, getTransactions } from './queries.js'
import { currentMonth, daysInMonth, monthList, monthRange, monthsBetween, shiftMonth, today } from './util.js'

const CATEGORY_COLUMNS = `id, name, emoji, scope, owner_user_id, group_id, rollover, target_cents, target_type, target_date, bucket, notes, sort, archived`

export const DEFAULT_METHOD_CONFIG: MethodConfig = {
  needs_pct: 50,
  wants_pct: 30,
  savings_pct: 20,
  savings_target_cents: null,
}

export function resolveMethodConfig(raw: string | null): MethodConfig {
  if (!raw) return { ...DEFAULT_METHOD_CONFIG }
  try {
    return { ...DEFAULT_METHOD_CONFIG, ...(JSON.parse(raw) as Partial<MethodConfig>) }
  } catch {
    return { ...DEFAULT_METHOD_CONFIG }
  }
}

export function effectiveBucket(category: Pick<Category, 'bucket' | 'scope'>): SpendBucket {
  return category.bucket ?? (category.scope === 'personal' ? 'want' : 'need')
}

interface MonthTotals {
  allocated: number
  spent: number
}

/**
 * Per-category ledger folded forward month by month. With rollover on, an
 * envelope's leftover (or overspend) carries into the next month; with it off
 * the envelope resets each month.
 */
function foldLedger(
  categories: Category[],
  allocations: Map<string, number>,
  spending: Map<string, number>,
  months: string[],
  targetMonth: string,
): Map<string, { carryover: number; allocated: number; spent: number; available: number }> {
  const result = new Map<string, { carryover: number; allocated: number; spent: number; available: number }>()
  for (const category of categories) {
    let carry = 0
    for (const month of months) {
      const key = `${category.id}|${month}`
      const allocated = allocations.get(key) ?? 0
      const spent = spending.get(key) ?? 0
      const carryover = category.rollover === 1 ? carry : 0
      const available = carryover + allocated - spent
      if (month === targetMonth) {
        result.set(category.id, { carryover, allocated, spent, available })
      }
      carry = category.rollover === 1 ? available : 0
    }
    if (!result.has(category.id)) {
      result.set(category.id, { carryover: 0, allocated: 0, spent: 0, available: 0 })
    }
  }
  return result
}

/** What to put in this envelope this month to stay on target. */
export function targetSuggestion(
  category: Pick<Category, 'target_type' | 'target_cents' | 'target_date'>,
  month: string,
  balanceBeforeAllocation: number,
): number | null {
  if (category.target_type === 'none' || category.target_cents == null) return null
  if (category.target_type === 'monthly') return category.target_cents
  if (!category.target_date) return category.target_cents
  const targetMonth = category.target_date.slice(0, 7)
  const monthsLeft = Math.max(1, monthsBetween(month, targetMonth) + 1)
  const needed = Math.max(0, category.target_cents - balanceBeforeAllocation)
  return Math.ceil(needed / monthsLeft)
}

function loadHistory(
  db: DatabaseSync,
  householdId: string,
  throughMonth: string,
): { allocations: Map<string, number>; spending: Map<string, number>; earliest: string } {
  const allocationRows = db
    .prepare(
      `SELECT a.category_id, a.month, a.amount_cents FROM allocations a
       JOIN categories c ON c.id = a.category_id
       WHERE c.household_id = ? AND a.month <= ?`,
    )
    .all(householdId, throughMonth) as { category_id: string; month: string; amount_cents: number }[]
  const spendingRows = db
    .prepare(
      `SELECT tl.category_id AS category_id, substr(t.date, 1, 7) AS month, SUM(tl.amount_cents) AS total
       FROM transaction_lines tl JOIN transactions t ON t.id = tl.transaction_id
       WHERE t.household_id = ? AND t.kind = 'expense' AND tl.category_id IS NOT NULL AND substr(t.date, 1, 7) <= ?
       GROUP BY tl.category_id, month`,
    )
    .all(householdId, throughMonth) as { category_id: string; month: string; total: number }[]

  const allocations = new Map<string, number>()
  for (const row of allocationRows) allocations.set(`${row.category_id}|${row.month}`, row.amount_cents)
  const spending = new Map<string, number>()
  for (const row of spendingRows) spending.set(`${row.category_id}|${row.month}`, row.total)

  const stamps = [...allocationRows.map((r) => r.month), ...spendingRows.map((r) => r.month)]
  const earliest = stamps.length > 0 ? stamps.reduce((min, m) => (m < min ? m : min)) : throughMonth
  return { allocations, spending, earliest }
}

export function effectiveIncomes(
  db: DatabaseSync,
  householdId: string,
  month: string,
): { id: string; name: string; color: string; income: number; gross: number; override: number | null }[] {
  const members = getMembers(db, householdId)
  const overrides = db
    .prepare('SELECT user_id, amount_cents FROM month_incomes WHERE household_id = ? AND month = ?')
    .all(householdId, month) as { user_id: string; amount_cents: number }[]
  return members.map((m) => {
    const override = overrides.find((o) => o.user_id === m.id)?.amount_cents ?? null
    return {
      id: m.id,
      name: m.name,
      color: m.color,
      income: override ?? m.monthly_income_cents,
      // Overrides describe take-home; without paycheck details gross falls back to it.
      gross: override ?? m.monthly_gross_cents,
      override,
    }
  })
}

export function computeBudget(db: DatabaseSync, householdId: string, month: string): BudgetResponse {
  const household = db
    .prepare('SELECT split_rule, split_basis, custom_split, budget_method, method_config FROM households WHERE id = ?')
    .get(householdId) as unknown as {
    split_rule: SplitRule
    split_basis: 'net' | 'gross'
    custom_split: string | null
    budget_method: BudgetMethod
    method_config: string | null
  }

  const categories = db
    .prepare(`SELECT ${CATEGORY_COLUMNS} FROM categories WHERE household_id = ? AND archived = 0 ORDER BY sort, name`)
    .all(householdId) as unknown as Category[]
  const groups = db
    .prepare('SELECT id, name, emoji, sort FROM category_groups WHERE household_id = ? ORDER BY sort, name')
    .all(householdId) as unknown as CategoryGroup[]

  const { allocations, spending, earliest } = loadHistory(db, householdId, month)
  const months = monthList(earliest <= month ? earliest : month, month)
  const ledger = foldLedger(categories, allocations, spending, months, month)

  const previousMonth = shiftMonth(month, -1)
  const rows: BudgetCategoryRow[] = categories.map((category) => {
    const entry = ledger.get(category.id)!
    const lastAllocated = allocations.get(`${category.id}|${previousMonth}`) ?? 0
    const lastSpent = spending.get(`${category.id}|${previousMonth}`) ?? 0
    const recent = [1, 2, 3].map((back) => spending.get(`${category.id}|${shiftMonth(month, -back)}`) ?? 0)
    const avg3 = Math.round(recent.reduce((sum, value) => sum + value, 0) / 3)
    return {
      ...category,
      effective_bucket: effectiveBucket(category),
      allocated_cents: entry.allocated,
      spent_cents: entry.spent,
      carryover_cents: entry.carryover,
      available_cents: entry.available,
      target_suggestion_cents: targetSuggestion(category, month, entry.carryover - entry.spent),
      last_month_allocated_cents: lastAllocated,
      last_month_spent_cents: lastSpent,
      avg3_spent_cents: avg3,
    }
  })

  const sharedRows = rows.filter((r) => r.scope === 'shared')
  const shared_allocated_cents = sharedRows.reduce((sum, r) => sum + r.allocated_cents, 0)
  const shared_spent_cents = sharedRows.reduce((sum, r) => sum + r.spent_cents, 0)
  const shared_available_cents = sharedRows.reduce((sum, r) => sum + r.available_cents, 0)

  const groupRows: BudgetGroupRow[] = groups.map((group) => {
    const inGroup = sharedRows.filter((r) => r.group_id === group.id)
    return {
      ...group,
      allocated_cents: inGroup.reduce((sum, r) => sum + r.allocated_cents, 0),
      spent_cents: inGroup.reduce((sum, r) => sum + r.spent_cents, 0),
      available_cents: inGroup.reduce((sum, r) => sum + r.available_cents, 0),
    }
  })

  const incomes = effectiveIncomes(db, householdId, month)
  const custom = household.custom_split ? (JSON.parse(household.custom_split) as Record<string, number>) : null
  const weights = incomes.map((m) => ({
    user_id: m.id,
    weight:
      household.split_rule === 'equal'
        ? 1
        : household.split_rule === 'custom'
          ? Math.round((custom?.[m.id] ?? 100 / incomes.length) * 100)
          : household.split_basis === 'gross'
            ? m.gross
            : m.income,
  }))
  const contributions = splitByWeights(shared_allocated_cents, weights)

  const members = incomes.map((member) => {
    const personal = rows.filter((r) => r.scope === 'personal' && r.owner_user_id === member.id)
    const personal_allocated_cents = personal.reduce((sum, r) => sum + r.allocated_cents, 0)
    const contribution_cents = contributions.find((c) => c.user_id === member.id)?.share_cents ?? 0
    return {
      id: member.id,
      name: member.name,
      color: member.color,
      monthly_income_cents: member.income,
      income_override_cents: member.override,
      contribution_cents,
      personal_allocated_cents,
      personal_spent_cents: personal.reduce((sum, r) => sum + r.spent_cents, 0),
      personal_available_cents: personal.reduce((sum, r) => sum + r.available_cents, 0),
      left_cents: member.income - contribution_cents - personal_allocated_cents,
    }
  })

  const { start, end } = monthRange(month)
  const uncategorized = db
    .prepare(
      `SELECT COUNT(DISTINCT t.id) AS count, COALESCE(SUM(tl.amount_cents), 0) AS amount
       FROM transaction_lines tl JOIN transactions t ON t.id = tl.transaction_id
       WHERE t.household_id = ? AND t.kind = 'expense' AND tl.category_id IS NULL AND t.date >= ? AND t.date < ?`,
    )
    .get(householdId, start, end) as { count: number; amount: number }

  const total_assigned_cents = rows.reduce((sum, r) => sum + r.allocated_cents, 0)
  const total_spent_cents = rows.reduce((sum, r) => sum + r.spent_cents, 0)
  const combined_income_cents = incomes.reduce((sum, m) => sum + m.income, 0)

  let pace: BudgetResponse['pace'] = null
  if (month === currentMonth()) {
    const day = Number(today().slice(8, 10))
    const days = daysInMonth(month)
    pace = {
      day,
      days_in_month: days,
      elapsed_pct: Math.round((day / days) * 100),
      spent_pct: total_assigned_cents > 0 ? Math.round((total_spent_cents / total_assigned_cents) * 100) : 0,
    }
  }

  const prevAllocated = [...allocations.keys()].some((key) => key.endsWith(`|${previousMonth}`))

  const method_config = resolveMethodConfig(household.method_config)
  const bucketDefs: { key: SpendBucket; pct: number }[] = [
    { key: 'need', pct: method_config.needs_pct },
    { key: 'want', pct: method_config.wants_pct },
    { key: 'save', pct: method_config.savings_pct },
  ]
  const buckets: BudgetBucketRow[] = bucketDefs.map(({ key, pct }) => {
    const inBucket = rows.filter((r) => r.effective_bucket === key)
    return {
      key,
      label: BUCKET_LABELS[key],
      pct,
      target_cents: Math.round((combined_income_cents * pct) / 100),
      spent_cents: inBucket.reduce((sum, r) => sum + r.spent_cents, 0),
      allocated_cents: inBucket.reduce((sum, r) => sum + r.allocated_cents, 0),
    }
  })

  return {
    month,
    split_rule: household.split_rule,
    custom_split: custom,
    budget_method: household.budget_method,
    method_config,
    buckets,
    members,
    groups: groupRows,
    categories: rows,
    shared_allocated_cents,
    shared_spent_cents,
    shared_available_cents,
    combined_income_cents,
    total_assigned_cents,
    total_spent_cents,
    unassigned_cents: combined_income_cents - total_assigned_cents,
    uncategorized: { count: uncategorized.count, amount_cents: uncategorized.amount },
    pace,
    has_allocations: rows.some((r) => r.allocated_cents > 0),
    prev_month_has_allocations: prevAllocated,
    // The route layers the household's default-budget info on top.
    default_effective: null,
  }
}

export function categoryDetail(
  db: DatabaseSync,
  householdId: string,
  categoryId: string,
  month: string,
): CategoryDetailResponse | null {
  const budget = computeBudget(db, householdId, month)
  const category = budget.categories.find((c) => c.id === categoryId)
  if (!category) return null

  const { allocations, spending } = loadHistory(db, householdId, month)
  const history = monthList(shiftMonth(month, -5), month).map((m) => ({
    month: m,
    allocated_cents: allocations.get(`${categoryId}|${m}`) ?? 0,
    spent_cents: spending.get(`${categoryId}|${m}`) ?? 0,
  }))

  const { start, end } = monthRange(month)
  const transactions = getTransactions(db, householdId, { start, end }).filter((t) =>
    t.lines.some((line) => line.category_id === categoryId),
  )
  return { category, history, transactions }
}

export function computeTrends(db: DatabaseSync, householdId: string, monthCount: number): TrendsResponse {
  const to = currentMonth()
  const from = shiftMonth(to, -(monthCount - 1))
  const months = monthList(from, to)
  const { allocations, spending } = loadHistory(db, householdId, to)

  const categories = db
    .prepare(`SELECT ${CATEGORY_COLUMNS} FROM categories WHERE household_id = ?`)
    .all(householdId) as unknown as Category[]
  const groups = db
    .prepare('SELECT id, name, emoji, sort FROM category_groups WHERE household_id = ? ORDER BY sort, name')
    .all(householdId) as unknown as CategoryGroup[]

  const incomeByMonth = new Map<string, number>()
  for (const month of months) {
    incomeByMonth.set(
      month,
      effectiveIncomes(db, householdId, month).reduce((sum, m) => sum + m.income, 0),
    )
  }

  const memberShares = db
    .prepare(
      `SELECT ts.user_id, substr(t.date, 1, 7) AS month, SUM(ts.share_cents) AS total
       FROM transaction_splits ts JOIN transactions t ON t.id = ts.transaction_id
       WHERE t.household_id = ? AND t.kind = 'expense' AND substr(t.date, 1, 7) >= ? AND substr(t.date, 1, 7) <= ?
       GROUP BY ts.user_id, month`,
    )
    .all(householdId, from, to) as { user_id: string; month: string; total: number }[]

  const trendMonths = months.map((month) => {
    let allocated = 0
    let spent = 0
    let sharedSpent = 0
    let personalSpent = 0
    for (const category of categories) {
      const key = `${category.id}|${month}`
      allocated += allocations.get(key) ?? 0
      const categorySpent = spending.get(key) ?? 0
      spent += categorySpent
      if (category.scope === 'shared') sharedSpent += categorySpent
      else personalSpent += categorySpent
    }
    const member_share_cents: Record<string, number> = {}
    for (const share of memberShares.filter((s) => s.month === month)) {
      member_share_cents[share.user_id] = share.total
    }
    return {
      month,
      income_cents: incomeByMonth.get(month) ?? 0,
      allocated_cents: allocated,
      spent_cents: spent,
      shared_spent_cents: sharedSpent,
      personal_spent_cents: personalSpent,
      member_share_cents,
    }
  })

  const sumSpent = (list: Category[]): number =>
    list.reduce((sum, c) => sum + months.reduce((inner, m) => inner + (spending.get(`${c.id}|${m}`) ?? 0), 0), 0)
  const members = db.prepare('SELECT id, name FROM users WHERE household_id = ?').all(householdId) as unknown as {
    id: string
    name: string
  }[]
  const by_group = [
    ...groups.map((group) => ({
      group_id: group.id,
      name: group.name,
      emoji: group.emoji,
      spent_cents: sumSpent(categories.filter((c) => c.group_id === group.id)),
    })),
    // Ungrouped personal envelopes read as each person's spending, not an anonymous "Ungrouped".
    ...members.map((member) => ({
      group_id: null,
      name: `${member.name.split(' ')[0]}’s personal`,
      emoji: '👤',
      spent_cents: sumSpent(
        categories.filter((c) => c.scope === 'personal' && c.owner_user_id === member.id && c.group_id == null),
      ),
    })),
    {
      group_id: null,
      name: 'Other shared',
      emoji: null,
      spent_cents: sumSpent(categories.filter((c) => c.scope === 'shared' && c.group_id == null)),
    },
  ].filter((g) => g.spent_cents > 0)

  const previous = shiftMonth(to, -1)
  const movers = categories
    .map((category) => ({
      id: category.id,
      name: category.name,
      emoji: category.emoji,
      spent_cents: spending.get(`${category.id}|${to}`) ?? 0,
      prev_spent_cents: spending.get(`${category.id}|${previous}`) ?? 0,
    }))
    .filter((m) => m.spent_cents > 0 || m.prev_spent_cents > 0)
    .sort((a, b) => Math.abs(b.spent_cents - b.prev_spent_cents) - Math.abs(a.spent_cents - a.prev_spent_cents))
    .slice(0, 6)

  return { months: trendMonths, by_group, movers }
}

export function quickFillAmount(row: BudgetCategoryRow, strategy: QuickFillStrategy): number | null {
  switch (strategy) {
    case 'last_month':
      return row.last_month_allocated_cents
    case 'spent_last_month':
      return row.last_month_spent_cents
    case 'avg3':
      return row.avg3_spent_cents
    case 'targets':
      return row.target_suggestion_cents
  }
}
