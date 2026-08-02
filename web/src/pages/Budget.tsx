import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { BudgetCategoryRow, BudgetResponse, QuickFillStrategy } from '@fold/shared'
import { ArrowRightLeft, ChevronLeft, ChevronRight, Pencil, Plus, Sparkles, Tag, Wand2 } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { currentMonth, fmtMoney, fmtMonth, shiftMonth } from '../format'
import { Avatar, Button, Card, CardTitle, EmptyState, ProgressBar, cls } from '../ui'
import { CategoryRow, GroupSection, TableHeader } from '../components/budget/rows'
import CategoryDrawer from '../components/budget/CategoryDrawer'
import IncomeSplitCard from '../components/budget/IncomeSplitCard'
import MethodHero from '../components/budget/MethodHero'
import TrendsCard from '../components/budget/TrendsCard'
import { IncomeOverrideModal, MoveMoneyModal, NewCategoryModal, NewGroupModal } from '../components/budget/modals'

const QUICK_FILLS: { strategy: QuickFillStrategy; label: string; hint: string }[] = [
  { strategy: 'last_month', label: 'Same as last month', hint: 'Copy every amount you budgeted last month' },
  { strategy: 'targets', label: 'Fund the targets', hint: 'Set each envelope to what its target needs this month' },
  { strategy: 'avg3', label: '3-month average', hint: 'Budget what you actually averaged over 3 months' },
  { strategy: 'spent_last_month', label: 'What we spent last month', hint: 'Match last month’s actual spending' },
]

function AutoFillMenu({ onPick }: { onPick: (strategy: QuickFillStrategy) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button variant="secondary" onClick={() => setOpen((value) => !value)}>
        <Wand2 size={14} /> Auto-fill
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            {QUICK_FILLS.map((fill) => (
              <button
                key={fill.strategy}
                onClick={() => {
                  setOpen(false)
                  onPick(fill.strategy)
                }}
                className="block w-full px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="block text-sm font-medium">{fill.label}</span>
                <span className="block text-xs text-slate-500">{fill.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function MemberCard({
  member,
  onEditIncome,
}: {
  member: BudgetResponse['members'][number]
  onEditIncome: () => void
}) {
  const { me } = useMe()
  const isMe = member.id === me.user.id
  const spentOfIncome = member.monthly_income_cents > 0
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2.5">
        <Avatar name={member.name} color={member.color} size={32} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {member.name} {isMe && <span className="text-xs font-normal text-slate-400">(you)</span>}
          </p>
          <button
            onClick={onEditIncome}
            className="group inline-flex items-center gap-1 text-xs text-slate-500 hover:text-violet-700"
          >
            {fmtMoney(member.monthly_income_cents)} income
            {member.income_override_cents != null && (
              <span className="rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700">override</span>
            )}
            <Pencil size={10} className="opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        </div>
      </div>

      {spentOfIncome && (
        <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            title="Share of the joint budget"
            style={{ width: `${(member.contribution_cents / member.monthly_income_cents) * 100}%`, backgroundColor: 'var(--color-accent)' }}
          />
          <div
            title="Personal envelopes"
            style={{ width: `${(member.personal_allocated_cents / member.monthly_income_cents) * 100}%`, backgroundColor: member.color }}
          />
        </div>
      )}

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="flex items-center gap-1.5 text-slate-500">
            <span className="h-2 w-2 rounded-sm bg-violet-600" /> Share of joint budget
          </dt>
          <dd className="font-medium tabular-nums">{fmtMoney(member.contribution_cents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="flex items-center gap-1.5 text-slate-500">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: member.color }} /> Personal envelopes
          </dt>
          <dd className="font-medium tabular-nums">{fmtMoney(member.personal_allocated_cents)}</dd>
        </div>
        <div className="flex items-baseline justify-between border-t border-slate-100 pt-1.5">
          <dt className="font-medium text-slate-600">Left to assign</dt>
          <dd
            className={cls(
              'text-lg font-bold tabular-nums',
              member.left_cents < 0 ? 'text-red-600' : member.left_cents === 0 ? 'text-slate-500' : 'text-emerald-600',
            )}
          >
            {fmtMoney(member.left_cents)}
          </dd>
        </div>
      </dl>
    </Card>
  )
}

export default function Budget() {
  const { me } = useMe()
  const [month, setMonth] = useState(currentMonth())
  const { data, reload } = useApi<BudgetResponse>(`/budget/${month}`)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<BudgetCategoryRow | null | undefined>(undefined)
  const [newCategory, setNewCategory] = useState<{ scope: 'shared' | 'personal'; owner?: string; groupId?: string } | null>(null)
  const [newGroup, setNewGroup] = useState(false)
  const [incomeMember, setIncomeMember] = useState<BudgetResponse['members'][number] | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => setNote(null), [month])

  const sharedByGroup = useMemo(() => {
    if (!data) return { grouped: [], ungrouped: [] as BudgetCategoryRow[] }
    const shared = data.categories.filter((c) => c.scope === 'shared')
    return {
      grouped: data.groups.map((group) => ({ group, rows: shared.filter((c) => c.group_id === group.id) })),
      ungrouped: shared.filter((c) => !c.group_id),
    }
  }, [data])

  if (!data) return null

  async function allocate(categoryId: string, cents: number): Promise<void> {
    await api.put(`/budget/${month}/allocations`, { category_id: categoryId, amount_cents: cents })
    reload()
  }

  async function quickFill(strategy: QuickFillStrategy): Promise<void> {
    const result = await api.post<{ filled: number }>(`/budget/${month}/quick-fill`, { strategy })
    setNote(result.filled > 0 ? `Updated ${result.filled} ${result.filled === 1 ? 'envelope' : 'envelopes'}.` : 'Nothing to change — everything already matches.')
    reload()
  }

  async function copyLastMonth(): Promise<void> {
    const result = await api.post<{ copied: number }>(`/budget/${month}/copy`, { from: shiftMonth(month, -1) })
    setNote(`Copied ${result.copied} amounts from ${fmtMonth(shiftMonth(month, -1))}.`)
    reload()
  }

  const ruleLabel =
    data.split_rule === 'equal' ? 'split 50/50' : data.split_rule === 'proportional' ? 'split by income' : 'split your way'
  const overspent = data.categories.filter((c) => c.available_cents < 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Budget</h1>
          <p className="text-sm text-slate-500">
            Shared costs are {ruleLabel} (<Link to="/settings" className="text-violet-600 hover:underline">change</Link>); what’s
            left is yours to spend.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <ChevronLeft size={17} />
          </button>
          <span className="w-36 text-center text-sm font-semibold">{fmtMonth(month)}</span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <ChevronRight size={17} />
          </button>
        </div>
      </div>

      {data.budget_method !== 'envelope' && <MethodHero data={data} />}

      {data.budget_method === 'envelope' && (
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Income this month</p>
            <p className="text-xl font-bold tabular-nums">{fmtMoney(data.combined_income_cents)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Assigned to envelopes</p>
            <p className="text-xl font-bold tabular-nums">{fmtMoney(data.total_assigned_cents)}</p>
            <p className="text-[11px] text-slate-400">
              {fmtMoney(data.shared_allocated_cents)} shared · {fmtMoney(data.total_assigned_cents - data.shared_allocated_cents)} personal
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Unassigned</p>
            <p
              className={cls(
                'text-xl font-bold tabular-nums',
                data.unassigned_cents < 0 ? 'text-red-600' : 'text-emerald-600',
              )}
            >
              {fmtMoney(data.unassigned_cents)}
            </p>
            <p className="text-[11px] text-slate-400">
              {data.unassigned_cents < 0 ? 'budgeted beyond income' : 'free to save or assign'}
            </p>
          </div>
        </div>

        {data.pace && data.total_assigned_cents > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-slate-500">
                Day {data.pace.day} of {data.pace.days_in_month} — {data.pace.elapsed_pct}% through the month
              </span>
              <span
                className={cls(
                  'font-medium',
                  data.pace.spent_pct > data.pace.elapsed_pct + 10 ? 'text-amber-600' : 'text-emerald-600',
                )}
              >
                {fmtMoney(data.total_spent_cents)} spent · {data.pace.spent_pct}% of budget
                {data.pace.spent_pct > data.pace.elapsed_pct + 10 ? ' — running hot' : ' — on pace'}
              </span>
            </div>
            <div className="relative">
              <ProgressBar value={data.total_spent_cents} max={data.total_assigned_cents} />
              <span
                className="absolute -top-0.5 h-3 w-px bg-slate-400"
                style={{ left: `${data.pace.elapsed_pct}%` }}
                title={`Today — ${data.pace.elapsed_pct}% of the month`}
              />
            </div>
          </div>
        )}
      </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {data.members.map((member) => (
          <MemberCard key={member.id} member={member} onEditIncome={() => setIncomeMember(member)} />
        ))}
      </div>

      <IncomeSplitCard month={month} onChanged={reload} />

      <div className="flex flex-wrap items-center gap-2">
        <AutoFillMenu onPick={(strategy) => void quickFill(strategy)} />
        {data.prev_month_has_allocations && (
          <Button variant="secondary" onClick={() => void copyLastMonth()}>
            Copy {fmtMonth(shiftMonth(month, -1))}
          </Button>
        )}
        <Button variant="secondary" onClick={() => setMoveTarget(null)}>
          <ArrowRightLeft size={14} /> Move money
        </Button>
        <Button variant="secondary" onClick={() => setNewCategory({ scope: 'shared' })}>
          <Plus size={14} /> Category
        </Button>
        <Button variant="ghost" onClick={() => setNewGroup(true)}>
          <Plus size={13} /> Group
        </Button>
      </div>

      {note && (
        <Card className="flex items-center justify-between bg-emerald-50/70 !py-2.5">
          <p className="text-sm text-emerald-800">{note}</p>
          <button onClick={() => setNote(null)} className="text-xs text-emerald-700 hover:underline">
            dismiss
          </button>
        </Card>
      )}

      {data.uncategorized.count > 0 && (
        <Link to="/transactions?needs=category" className="block">
          <Card className="flex items-center justify-between bg-amber-50/70 !py-3 transition-colors hover:bg-amber-100/70">
            <p className="flex items-center gap-2 text-sm text-amber-900">
              <Tag size={15} />
              <span>
                <strong>{data.uncategorized.count}</strong> transaction{data.uncategorized.count === 1 ? '' : 's'} (
                {fmtMoney(data.uncategorized.amount_cents)}) still need a category — they’re missing from these totals.
              </span>
            </p>
            <span className="shrink-0 text-xs font-medium text-amber-800">Classify →</span>
          </Card>
        </Link>
      )}

      {overspent.length > 0 && (
        <Card className="!py-3">
          <p className="text-sm text-slate-700">
            <strong className="text-red-600">{overspent.length} envelope{overspent.length === 1 ? '' : 's'} overspent.</strong>{' '}
            Cover {overspent.length === 1 ? 'it' : 'them'} by moving money from somewhere with room:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {overspent.map((row) => (
              <button
                key={row.id}
                onClick={() => setMoveTarget(row)}
                className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                {row.emoji} {row.name} · {fmtMoney(row.available_cents)}
              </button>
            ))}
          </div>
        </Card>
      )}

      {!data.has_allocations && (
        <EmptyState emoji="🪺" title={`No budget set for ${fmtMonth(month)} yet`}>
          {data.prev_month_has_allocations ? (
            <span>
              Copy last month to get going, or use Auto-fill above — then tweak any envelope inline.
            </span>
          ) : (
            <span>Type an amount next to each category below, or hit Auto-fill to start from your targets.</span>
          )}
        </EmptyState>
      )}

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Our shared budget</h2>
            <p className="text-xs text-slate-500">
              {fmtMoney(data.shared_spent_cents)} spent of {fmtMoney(data.shared_allocated_cents)} ·{' '}
              <span className={data.shared_available_cents < 0 ? 'font-medium text-red-600' : ''}>
                {fmtMoney(data.shared_available_cents)} available
              </span>
            </p>
          </div>
        </div>
        <TableHeader />
        {sharedByGroup.grouped.map(({ group, rows }) => (
          <GroupSection
            key={group.id}
            group={group}
            collapsed={collapsed[group.id] ?? false}
            onToggle={() => setCollapsed((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
          >
            {rows.length === 0 ? (
              <button
                onClick={() => setNewCategory({ scope: 'shared', groupId: group.id })}
                className="py-2 text-xs text-slate-400 hover:text-violet-600"
              >
                + add a category here
              </button>
            ) : (
              rows.map((row) => (
                <CategoryRow
                  key={row.id}
                  row={row}
                  accent="var(--color-accent)"
                  onAllocate={(cents) => void allocate(row.id, cents)}
                  onOpen={() => setDrawerId(row.id)}
                  onCover={() => setMoveTarget(row)}
                />
              ))
            )}
          </GroupSection>
        ))}
        {sharedByGroup.ungrouped.length > 0 && (
          <div className="border-t border-slate-100 pt-1">
            {sharedByGroup.ungrouped.map((row) => (
              <CategoryRow
                key={row.id}
                row={row}
                accent="var(--color-accent)"
                onAllocate={(cents) => void allocate(row.id, cents)}
                onOpen={() => setDrawerId(row.id)}
                onCover={() => setMoveTarget(row)}
              />
            ))}
          </div>
        )}
      </Card>

      {data.members.map((member) => {
        const rows = data.categories.filter((c) => c.scope === 'personal' && c.owner_user_id === member.id)
        const isMe = member.id === me.user.id
        return (
          <Card key={member.id}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Avatar name={member.name} color={member.color} size={26} />
                <div>
                  <h2 className="font-semibold">{isMe ? 'My personal budget' : `${member.name}’s personal budget`}</h2>
                  <p className="text-xs text-slate-500">
                    {fmtMoney(member.personal_spent_cents)} spent of {fmtMoney(member.personal_allocated_cents)} ·{' '}
                    {fmtMoney(member.personal_available_cents)} available
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                onClick={() => setNewCategory({ scope: 'personal', owner: member.id })}
                className="text-xs"
              >
                <Plus size={13} /> Category
              </Button>
            </div>
            <TableHeader />
            <div className="pt-1">
              {rows.length === 0 ? (
                <p className="py-3 text-sm text-slate-400">No personal envelopes yet.</p>
              ) : (
                rows.map((row) => (
                  <CategoryRow
                    key={row.id}
                    row={row}
                    accent={member.color}
                    onAllocate={(cents) => void allocate(row.id, cents)}
                    onOpen={() => setDrawerId(row.id)}
                    onCover={() => setMoveTarget(row)}
                  />
                ))
              )}
            </div>
          </Card>
        )
      })}

      <TrendsCard />

      <p className="flex items-center justify-center gap-1.5 pb-2 text-xs text-slate-400">
        <Sparkles size={12} />
        Tip: press Enter in a budget box to jump to the next envelope.
      </p>

      {drawerId && (
        <CategoryDrawer
          categoryId={drawerId}
          month={month}
          groups={data.groups}
          onClose={() => setDrawerId(null)}
          onChanged={reload}
          onMoveMoney={(row) => {
            setDrawerId(null)
            setMoveTarget(row)
          }}
        />
      )}
      {moveTarget !== undefined && (
        <MoveMoneyModal
          budget={data}
          month={month}
          target={moveTarget}
          onClose={() => setMoveTarget(undefined)}
          onSaved={() => {
            setMoveTarget(undefined)
            reload()
          }}
        />
      )}
      {newCategory && (
        <NewCategoryModal
          groups={data.groups}
          defaultScope={newCategory.scope}
          defaultOwner={newCategory.owner}
          defaultGroupId={newCategory.groupId}
          onClose={() => setNewCategory(null)}
          onSaved={() => {
            setNewCategory(null)
            reload()
          }}
        />
      )}
      {newGroup && (
        <NewGroupModal
          onClose={() => setNewGroup(false)}
          onSaved={() => {
            setNewGroup(false)
            reload()
          }}
        />
      )}
      {incomeMember && (
        <IncomeOverrideModal
          month={month}
          member={incomeMember}
          onClose={() => setIncomeMember(null)}
          onSaved={() => {
            setIncomeMember(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
