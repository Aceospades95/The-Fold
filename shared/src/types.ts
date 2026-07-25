export type Cadence = 'monthly' | 'semimonthly' | 'biweekly' | 'weekly' | 'annual'
export type SplitRule = 'equal' | 'proportional' | 'custom'
export type CategoryScope = 'shared' | 'personal'
export type TxKind = 'expense' | 'settlement'
export type TripStatus = 'idea' | 'planned' | 'active' | 'done'
export type ListType = 'todo' | 'chores' | 'grocery' | 'wishlist' | 'custom'

export interface UserPublic {
  id: string
  name: string
  email: string
  color: string
}

export interface Member extends UserPublic {
  monthly_income_cents: number
}

export interface HouseholdInfo {
  id: string
  name: string
  split_rule: SplitRule
  custom_split: Record<string, number> | null
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
  amount_cents: number
  cadence: Cadence
  active: 0 | 1
  notes: string | null
}

export interface Category {
  id: string
  name: string
  emoji: string | null
  scope: CategoryScope
  owner_user_id: string | null
  sort: number
  archived: 0 | 1
}

export interface BudgetCategoryRow extends Category {
  allocated_cents: number
  spent_cents: number
}

export interface BudgetMemberRow {
  id: string
  name: string
  color: string
  monthly_income_cents: number
  contribution_cents: number
  personal_allocated_cents: number
  personal_spent_cents: number
  left_cents: number
}

export interface BudgetResponse {
  month: string
  split_rule: SplitRule
  custom_split: Record<string, number> | null
  members: BudgetMemberRow[]
  categories: BudgetCategoryRow[]
  shared_allocated_cents: number
  shared_spent_cents: number
  has_allocations: boolean
}

export interface Split {
  user_id: string
  share_cents: number
}

export interface Tx {
  id: string
  kind: TxKind
  date: string
  description: string
  amount_cents: number
  category_id: string | null
  payer_user_id: string
  trip_expense_id: string | null
  notes: string | null
  splits: Split[]
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
}
