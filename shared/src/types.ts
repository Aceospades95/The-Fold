export type Cadence = 'monthly' | 'semimonthly' | 'biweekly' | 'weekly' | 'annual'
export type SplitRule = 'equal' | 'proportional' | 'custom'
export type CategoryScope = 'shared' | 'personal'
export type TxKind = 'expense' | 'settlement'
export type TripStatus = 'idea' | 'planned' | 'active' | 'done'
export type ListType = 'todo' | 'chores' | 'grocery' | 'wishlist' | 'custom'

export type SplitBasis = 'net' | 'gross'
export type DeductionKind = 'tax' | 'pretax' | 'posttax'

export interface PayDeduction {
  name: string
  amount_cents: number
  kind: DeductionKind
}

/**
 * Curated member colors. The web CSS ships a dark-mode variant for each
 * (--member-<hex>), so pickers must stay inside this list — arbitrary hexes
 * would wash out on dark cards.
 */
export const MEMBER_PALETTE = [
  '#8b5cf6', // violet
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#14b8a6', // teal
  '#10b981', // emerald
  '#f59e0b', // amber
  '#f97316', // orange
  '#f43f5e', // rose
] as const

export const MEMBER_COLOR_LABELS: Record<string, string> = {
  '#8b5cf6': 'Violet',
  '#0ea5e9': 'Sky',
  '#3b82f6': 'Blue',
  '#14b8a6': 'Teal',
  '#10b981': 'Emerald',
  '#f59e0b': 'Amber',
  '#f97316': 'Orange',
  '#f43f5e': 'Rose',
}

export interface UserPublic {
  id: string
  name: string
  email: string
  color: string
  is_admin: 0 | 1
}

export interface Member extends UserPublic {
  /** Take-home (net) per month. */
  monthly_income_cents: number
  /** Gross per month where paycheck details exist; falls back to net. */
  monthly_gross_cents: number
}

export interface HouseholdInfo {
  id: string
  name: string
  split_rule: SplitRule
  split_basis: SplitBasis
  custom_split: Record<string, number> | null
  budget_method: BudgetMethod
  method_config: MethodConfig
  calendar_path: string
  members: Member[]
}

export interface MeResponse {
  user: UserPublic
  household: HouseholdInfo
}

export interface IncomeSource {
  id: string
  user_id: string
  name: string
  /** Take-home (net) per paycheck. */
  amount_cents: number
  gross_cents: number | null
  deductions: PayDeduction[] | null
  cadence: Cadence
  active: 0 | 1
  notes: string | null
}

export interface InviteInfo {
  code: string
  expires_at: string
}

export interface IncomeSummaryMember {
  user_id: string
  name: string
  color: string
  gross_cents: number
  tax_cents: number
  pretax_cents: number
  posttax_cents: number
  net_cents: number
  has_breakdown: boolean
}

export interface IncomeSplitOption {
  key: 'equal' | 'net' | 'gross'
  label: string
  shares: { user_id: string; pct: number; contribution_cents: number }[]
}

export interface IncomeSummaryResponse {
  month: string
  shared_allocated_cents: number
  members: IncomeSummaryMember[]
  options: IncomeSplitOption[]
  /** Which option is currently active ('custom' when custom percentages are set). */
  active_key: 'equal' | 'net' | 'gross' | 'custom'
}

export type TargetType = 'none' | 'monthly' | 'by_date'
export type BudgetMethod = 'envelope' | 'fifty_thirty_twenty' | 'pay_yourself_first' | 'tracker'
export type SpendBucket = 'need' | 'want' | 'save'

export interface MethodConfig {
  needs_pct: number
  wants_pct: number
  savings_pct: number
  /** Pay-yourself-first target; null derives it from savings_pct × income. */
  savings_target_cents: number | null
}

export const BUCKET_LABELS: Record<SpendBucket, string> = {
  need: 'Needs',
  want: 'Wants',
  save: 'Savings',
}

export const METHOD_LABELS: Record<BudgetMethod, string> = {
  envelope: 'Envelopes (zero-based)',
  fifty_thirty_twenty: '50 / 30 / 20',
  pay_yourself_first: 'Pay yourself first',
  tracker: 'Just track spending',
}

export interface BudgetBucketRow {
  key: SpendBucket
  label: string
  pct: number
  target_cents: number
  spent_cents: number
  allocated_cents: number
}

export interface CategoryGroup {
  id: string
  name: string
  emoji: string | null
  sort: number
}

export interface Category {
  id: string
  name: string
  emoji: string | null
  scope: CategoryScope
  owner_user_id: string | null
  group_id: string | null
  rollover: 0 | 1
  target_cents: number | null
  target_type: TargetType
  target_date: string | null
  /** Need/want/save classification driving the 50/30/20 & savings views. */
  bucket: SpendBucket | null
  notes: string | null
  sort: number
  archived: 0 | 1
}

export interface BudgetCategoryRow extends Category {
  /** bucket with the fallback applied (personal → want, shared → need). */
  effective_bucket: SpendBucket
  /** Money assigned to this envelope for the month. */
  allocated_cents: number
  spent_cents: number
  /** Balance carried in from last month (0 unless rollover is on). */
  carryover_cents: number
  /** carryover + allocated − spent. Negative means overspent. */
  available_cents: number
  /** What to budget this month to stay on target (null when no target). */
  target_suggestion_cents: number | null
  last_month_allocated_cents: number
  last_month_spent_cents: number
  avg3_spent_cents: number
}

export interface BudgetGroupRow extends CategoryGroup {
  allocated_cents: number
  spent_cents: number
  available_cents: number
}

export interface BudgetMemberRow {
  id: string
  name: string
  color: string
  monthly_income_cents: number
  income_override_cents: number | null
  contribution_cents: number
  personal_allocated_cents: number
  personal_spent_cents: number
  personal_available_cents: number
  /** income − share of the joint budget − personal envelopes. */
  left_cents: number
}

export interface BudgetPace {
  day: number
  days_in_month: number
  elapsed_pct: number
  spent_pct: number
}

export interface BudgetResponse {
  month: string
  split_rule: SplitRule
  custom_split: Record<string, number> | null
  budget_method: BudgetMethod
  method_config: MethodConfig
  buckets: BudgetBucketRow[]
  members: BudgetMemberRow[]
  groups: BudgetGroupRow[]
  categories: BudgetCategoryRow[]
  shared_allocated_cents: number
  shared_spent_cents: number
  shared_available_cents: number
  combined_income_cents: number
  total_assigned_cents: number
  total_spent_cents: number
  unassigned_cents: number
  uncategorized: { count: number; amount_cents: number }
  pace: BudgetPace | null
  has_allocations: boolean
  prev_month_has_allocations: boolean
  /** Start month of the default budget in force for this month, if any. */
  default_effective: string | null
}

export interface CategoryHistoryPoint {
  month: string
  allocated_cents: number
  spent_cents: number
}

export interface CategoryDetailResponse {
  category: BudgetCategoryRow
  history: CategoryHistoryPoint[]
  transactions: Tx[]
}

export interface TrendMonth {
  month: string
  income_cents: number
  allocated_cents: number
  spent_cents: number
  shared_spent_cents: number
  personal_spent_cents: number
  /** Each member's share of the month's spending (from transaction splits). */
  member_share_cents: Record<string, number>
}

export interface TrendsResponse {
  months: TrendMonth[]
  by_group: { group_id: string | null; name: string; emoji: string | null; spent_cents: number }[]
  movers: { id: string; name: string; emoji: string | null; spent_cents: number; prev_spent_cents: number }[]
}

export type QuickFillStrategy = 'last_month' | 'avg3' | 'spent_last_month' | 'targets'

export interface Split {
  user_id: string
  share_cents: number
}

/** One slice of a purchase assigned to a category. */
export interface TxLine {
  id: string
  category_id: string | null
  amount_cents: number
  note: string | null
}

export interface Tx {
  id: string
  kind: TxKind
  date: string
  description: string
  /** Negative = refund/credit: reduces category spending and reverses splits. */
  amount_cents: number
  /** The single line's category, or null when the purchase spans several. */
  category_id: string | null
  payer_user_id: string
  account_id: string | null
  merchant_id: string | null
  import_batch_id: string | null
  trip_expense_id: string | null
  recurring_id: string | null
  notes: string | null
  /** 1 once the bank shows it (imports arrive cleared; manual entries start pending). */
  cleared: 0 | 1
  splits: Split[]
  lines: TxLine[]
}

export interface Merchant {
  id: string
  name: string
  domain: string | null
  uses: number
  top_category_id: string | null
  last_date: string | null
}

export interface DuplicateTxInfo {
  id: string
  date: string
  description: string
  amount_cents: number
  payer_user_id: string
  imported: boolean
}

export interface DuplicatePair {
  a: DuplicateTxInfo
  b: DuplicateTxInfo
}

export interface ImportBatch {
  id: string
  account_id: string | null
  account_name: string | null
  filename: string | null
  created_at: string
  imported_count: number
  total_cents: number
}

/** Remembered per-account statement settings so re-imports are one click. */
export interface ImportProfile {
  date_col: number
  desc_col: number
  amount_col: number
  has_header: boolean
  negative_is_spending: boolean
  payer_user_id: string | null
  default_mode: 'none' | 'equal' | 'income' | 'owed'
  include_credits: boolean
}

export interface TxFilters {
  q?: string
  category_id?: string
  account_id?: string
  payer_user_id?: string
}

export type RecurringCadence = 'monthly' | 'yearly'

export interface RecurringTx {
  id: string
  description: string
  amount_cents: number
  category_id: string | null
  payer_user_id: string
  splits: Split[]
  cadence: RecurringCadence
  day_of_month: number
  next_date: string
  active: 0 | 1
  notes: string | null
}

export type AccountType =
  | 'checking'
  | 'savings'
  | 'investment'
  | 'retirement'
  | 'property'
  | 'vehicle'
  | 'credit'
  | 'loan'
  | 'other'

export const LIABILITY_TYPES: AccountType[] = ['credit', 'loan']

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  investment: 'Investments',
  retirement: 'Retirement',
  property: 'Property',
  vehicle: 'Vehicle',
  credit: 'Credit card',
  loan: 'Loan',
  other: 'Other',
}

export interface AccountRow {
  id: string
  name: string
  type: AccountType
  owner_user_id: string | null
  archived: 0 | 1
  sort: number
  balance_cents: number
  balance_date: string | null
}

export interface NetWorthPoint {
  month: string
  assets_cents: number
  liabilities_cents: number
  net_cents: number
}

export interface NetWorthResponse {
  accounts: AccountRow[]
  history: NetWorthPoint[]
  assets_cents: number
  liabilities_cents: number
  net_cents: number
  delta_month_cents: number | null
}

export interface ImportRule {
  id: string
  match_text: string
  category_id: string | null
  split_mode: 'none' | 'equal' | 'income' | 'owed'
}

export interface HaConfig {
  url: string | null
  events: {
    item_due: boolean
    trip_countdown: boolean
    budget_over: boolean
  }
}

export interface ApiTokenInfo {
  id: string
  name: string
  created_at: string
  last_used_at: string | null
}

export interface BalanceEntry {
  user_id: string
  paid_cents: number
  share_cents: number
  net_cents: number
}

export interface BalancesResponse {
  balances: BalanceEntry[]
  suggestion: { from_user_id: string; to_user_id: string; amount_cents: number } | null
}

export interface Trip {
  id: string
  name: string
  emoji: string | null
  status: TripStatus
  location: string | null
  start_date: string | null
  end_date: string | null
  total_budget_cents: number | null
  notes: string | null
}

export interface TripListItem extends Trip {
  budget_cents: number
  planned_cents: number
  spent_cents: number
}

export interface TripCategory {
  id: string
  trip_id: string
  name: string
  budget_cents: number
  sort: number
}

export interface TripCategoryRow extends TripCategory {
  planned_cents: number
  spent_cents: number
}

export interface TripStop {
  id: string
  trip_id: string
  sort: number
  name: string
  location: string | null
  arrive_date: string | null
  depart_date: string | null
  lodging: string | null
  notes: string | null
}

export interface TripExpense {
  id: string
  trip_id: string
  trip_category_id: string | null
  stop_id: string | null
  name: string
  planned_cents: number
  actual_cents: number | null
  date: string | null
  payer_user_id: string | null
  posted_transaction_id: string | null
  notes: string | null
}

export interface TripDetailResponse {
  trip: Trip
  categories: TripCategoryRow[]
  stops: TripStop[]
  expenses: TripExpense[]
  totals: {
    budget_cents: number
    planned_cents: number
    spent_cents: number
    budget_source: 'total' | 'categories'
  }
}

export interface ListItemRow {
  id: string
  list_id: string
  text: string
  notes: string | null
  url: string | null
  amount_cents: number | null
  assignee_user_id: string | null
  due_date: string | null
  done: 0 | 1
  sort: number
  created_at: string
  completed_at: string | null
}

export interface ListRow {
  id: string
  name: string
  type: ListType
  emoji: string | null
  sort: number
  archived: 0 | 1
  items: ListItemRow[]
}

export interface InsightsResponse {
  months: number
  from: string
  to: string
  /** One entry per day with activity: expenses net of refunds. */
  daily: { date: string; total_cents: number; count: number }[]
  habits: {
    no_spend_days_30: number
    longest_no_spend_streak_30: number
    /** 0 = Sunday … 6 = Saturday. */
    busiest_weekday: number
    weekend_share_pct: number
    autopilot_share_pct: number
    avg_purchase_cents: number
    tx_per_week: number
  }
  burn: {
    days_in_month: number
    today_day: number
    /** Cumulative spend by day of month, index 0 = day 1. */
    this_month: number[]
    last_month: number[]
    budget_cents: number
  }
  /** Average spend per occurrence of each weekday, Sun..Sat. */
  weekday_avg: number[]
  /** This month's money flow: each member's income into shared / their personal / kept. */
  flow: {
    month: string
    members: {
      user_id: string
      name: string
      color: string
      income_cents: number
      shared_cents: number
      personal_cents: number
      kept_cents: number
    }[]
    shared_total_cents: number
  }
  /** Category totals over the window, tagged with their group for the treemap. */
  treemap: { category_id: string; name: string; emoji: string | null; group: string; total_cents: number }[]
  merchants: { id: string; name: string; domain: string | null; total_cents: number; visits: number }[]
  /** Per-category monthly spend over the window, oldest first. */
  sparklines: { category_id: string; name: string; emoji: string | null; scope: CategoryScope; months: number[] }[]
}

export interface ReviewHighlight {
  category_id: string
  name: string
  emoji: string | null
  amount_cents: number
}

export interface ReviewResponse {
  month: string
  has_prev: boolean
  has_next: boolean
  income_cents: number
  spent_cents: number
  kept_cents: number
  /** Percent of income kept; null when no income is set up. */
  savings_rate: number | null
  shared_spent_cents: number
  transactions_count: number
  uncategorized_count: number
  vs_prev: { spent_delta_cents: number; income_delta_cents: number } | null
  members: { user_id: string; name: string; color: string; share_cents: number; personal_spent_cents: number }[]
  /** Envelopes that ended the month in the red (amount = how far over). */
  overspent: ReviewHighlight[]
  /** Non-rollover envelopes that came in under budget (amount = left unspent). */
  wins: ReviewHighlight[]
  /** Rollover envelopes carrying a positive balance forward (amount = what rolls). */
  rolled_forward: ReviewHighlight[]
  top_categories: { category_id: string; name: string; emoji: string | null; spent_cents: number; allocated_cents: number }[]
  biggest_purchases: {
    id: string
    date: string
    description: string
    amount_cents: number
    merchant_name: string | null
    payer_user_id: string
  }[]
  /** The running who-owes-whom as of now (not month-scoped). */
  balance: BalancesResponse['suggestion']
  /** Net-worth change this month — only when reviewing the current month. */
  net_worth_delta_cents: number | null
}

export interface SummaryResponse {
  month: string
  shared_allocated_cents: number
  shared_spent_cents: number
  my_personal_allocated_cents: number
  my_personal_spent_cents: number
  balances: BalancesResponse
  next_trip: (TripListItem & { days_until: number | null }) | null
  my_tasks: { id: string; list_id: string; list_name: string; text: string; due_date: string | null }[]
  recent_transactions: Tx[]
  net_worth: { net_cents: number; delta_month_cents: number | null; account_count: number } | null
  setup: { has_income: boolean; has_budget: boolean; has_transaction: boolean; partner_linked: boolean }
}
