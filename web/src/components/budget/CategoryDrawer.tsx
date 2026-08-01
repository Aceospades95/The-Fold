import { useState } from 'react'
import type { BudgetCategoryRow, CategoryDetailResponse, CategoryGroup, SpendBucket, TargetType } from '@fold/shared'
import { BUCKET_LABELS } from '@fold/shared'
import { Archive, ArrowRightLeft } from 'lucide-react'
import { api, useApi } from '../../api'
import { useMe } from '../../App'
import { fmtDate, fmtMoney, fmtMonthShort } from '../../format'
import { Avatar, Button, ErrorNote, Field, Modal, MoneyInput, Select, TextInput, cls } from '../../ui'

function HistoryChart({ history }: { history: CategoryDetailResponse['history'] }) {
  const max = Math.max(1, ...history.map((h) => Math.max(h.allocated_cents, h.spent_cents)))
  return (
    <div className="flex items-end justify-between gap-2">
      {history.map((point) => {
        const over = point.spent_cents > point.allocated_cents && point.allocated_cents > 0
        return (
          <div key={point.month} className="flex flex-1 flex-col items-center gap-1">
            <div className="relative flex h-24 w-full items-end justify-center gap-0.5">
              <div
                title={`Budgeted ${fmtMoney(point.allocated_cents)}`}
                className="w-2.5 rounded-t bg-slate-200"
                style={{ height: `${(point.allocated_cents / max) * 100}%` }}
              />
              <div
                title={`Spent ${fmtMoney(point.spent_cents)}`}
                className={cls('w-2.5 rounded-t', over ? 'bg-red-400' : 'bg-violet-500')}
                style={{ height: `${(point.spent_cents / max) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-400">{fmtMonthShort(point.month)}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function CategoryDrawer({
  categoryId,
  month,
  groups,
  onClose,
  onChanged,
  onMoveMoney,
}: {
  categoryId: string
  month: string
  groups: CategoryGroup[]
  onClose: () => void
  onChanged: () => void
  onMoveMoney: (row: BudgetCategoryRow) => void
}) {
  const { me } = useMe()
  const { data, reload } = useApi<CategoryDetailResponse>(`/budget/${month}/categories/${categoryId}`)
  const [tab, setTab] = useState<'activity' | 'settings'>('activity')
  const [error, setError] = useState<string | null>(null)

  if (!data) return null
  const row = data.category

  async function patch(body: Record<string, unknown>): Promise<void> {
    setError(null)
    try {
      await api.patch(`/categories/${categoryId}`, body)
      reload()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function allocate(cents: number): Promise<void> {
    await api.put(`/budget/${month}/allocations`, { category_id: categoryId, amount_cents: cents })
    reload()
    onChanged()
  }

  async function archive(): Promise<void> {
    if (!confirm(`Remove "${row.name}" from the budget? Past spending stays on record.`)) return
    await api.delete(`/categories/${categoryId}`)
    onChanged()
    onClose()
  }

  const funded = row.allocated_cents + row.carryover_cents
  const quickActions: { label: string; cents: number }[] = [
    { label: 'Last month', cents: row.last_month_allocated_cents },
    { label: '3-mo average', cents: row.avg3_spent_cents },
    { label: 'Spent last month', cents: row.last_month_spent_cents },
  ]
  if (row.target_suggestion_cents != null) {
    quickActions.push({ label: 'Fund target', cents: row.target_suggestion_cents })
  }

  return (
    <Modal title={`${row.emoji ?? '🏷️'} ${row.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-2 rounded-xl bg-slate-50 p-3 text-center">
          {[
            ['Carried in', row.carryover_cents],
            ['Budgeted', row.allocated_cents],
            ['Spent', row.spent_cents],
            ['Available', row.available_cents],
          ].map(([label, value], index) => (
            <div key={label as string}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
              <p
                className={cls(
                  'text-sm font-bold tabular-nums',
                  index === 3 && (value as number) < 0 && 'text-red-600',
                  index === 3 && (value as number) > 0 && 'text-emerald-600',
                )}
              >
                {fmtMoney(value as number)}
              </p>
            </div>
          ))}
        </div>

        <div className="flex gap-1 border-b border-slate-200">
          {(['activity', 'settings'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cls(
                '-mb-px border-b-2 px-3 py-1.5 text-sm font-medium capitalize',
                tab === value ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              {value}
            </button>
          ))}
        </div>

        {tab === 'activity' ? (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Budgeted vs spent, last 6 months
              </p>
              <HistoryChart history={data.history} />
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">This month</p>
              {data.transactions.length === 0 ? (
                <p className="py-3 text-center text-sm text-slate-400">Nothing spent here yet.</p>
              ) : (
                <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
                  {data.transactions.map((tx) => {
                    const payer = me.household.members.find((m) => m.id === tx.payer_user_id)
                    return (
                      <li key={tx.id} className="flex items-center gap-2.5 py-2">
                        {payer && <Avatar name={payer.name} color={payer.color} size={22} />}
                        <span className="min-w-0 flex-1 truncate text-sm">{tx.description}</span>
                        <span className="text-xs text-slate-400">{fmtDate(tx.date)}</span>
                        <span className="text-sm font-medium tabular-nums">{fmtMoney(tx.amount_cents)}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Set this month to</p>
              <div className="flex flex-wrap gap-1.5">
                {quickActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => void allocate(action.cents)}
                    className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-violet-400 hover:text-violet-700"
                  >
                    {action.label} · {fmtMoney(action.cents)}
                  </button>
                ))}
                <button
                  onClick={() => onMoveMoney(row)}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-violet-400 hover:text-violet-700"
                >
                  <ArrowRightLeft size={11} /> Move money
                </button>
              </div>
              {funded !== row.allocated_cents && (
                <p className="mt-2 text-xs text-slate-400">
                  Funded this month: {fmtMoney(funded)} ({fmtMoney(row.carryover_cents)} rolled over).
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_5rem] gap-3">
              <Field label="Name">
                <TextInput
                  defaultValue={row.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== row.name && void patch({ name: e.target.value.trim() })}
                />
              </Field>
              <Field label="Emoji">
                <TextInput
                  defaultValue={row.emoji ?? ''}
                  onBlur={(e) => e.target.value !== (row.emoji ?? '') && void patch({ emoji: e.target.value || null })}
                />
              </Field>
            </div>

            {row.scope === 'shared' && (
              <Field label="Group">
                <Select value={row.group_id ?? ''} onChange={(e) => void patch({ group_id: e.target.value || null })}>
                  <option value="">No group</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.emoji} {group.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
              <input
                type="checkbox"
                checked={row.rollover === 1}
                onChange={(e) => void patch({ rollover: e.target.checked ? 1 : 0 })}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600"
              />
              <span>
                <span className="block text-sm font-medium">Roll leftover into next month</span>
                <span className="block text-xs text-slate-500">
                  For envelopes that save up — travel, car repairs, gifts. Off means the envelope resets every month.
                </span>
              </span>
            </label>

            <Field
              label="Counts as"
              hint="Feeds the 50/30/20 and pay-yourself-first views — needs vs wants vs money put away."
            >
              <Select
                value={row.effective_bucket}
                onChange={(e) => void patch({ bucket: e.target.value as SpendBucket })}
              >
                {(Object.entries(BUCKET_LABELS) as [SpendBucket, string][]).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Target">
              <Select
                value={row.target_type}
                onChange={(e) => {
                  const type = e.target.value as TargetType
                  void patch({
                    target_type: type,
                    target_cents: type === 'none' ? null : (row.target_cents ?? 0),
                  })
                }}
              >
                <option value="none">No target</option>
                <option value="monthly">Budget this much every month</option>
                <option value="by_date">Save up this much by a date</option>
              </Select>
            </Field>

            {row.target_type !== 'none' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount">
                  <MoneyInput
                    cents={row.target_cents}
                    onCents={(cents) => cents != null && cents !== row.target_cents && void patch({ target_cents: cents })}
                  />
                </Field>
                {row.target_type === 'by_date' && (
                  <Field label="By">
                    <TextInput
                      type="date"
                      defaultValue={row.target_date ?? ''}
                      onChange={(e) => e.target.value && void patch({ target_date: e.target.value })}
                    />
                  </Field>
                )}
              </div>
            )}

            {row.target_type === 'by_date' && row.target_suggestion_cents != null && (
              <p className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800">
                Put <strong>{fmtMoney(row.target_suggestion_cents)}</strong> in each month to hit{' '}
                {fmtMoney(row.target_cents ?? 0)} by {row.target_date}.
              </p>
            )}

            <ErrorNote message={error} />
            <div className="flex justify-between border-t border-slate-100 pt-3">
              <Button variant="danger" onClick={() => void archive()}>
                <Archive size={14} /> Remove category
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
