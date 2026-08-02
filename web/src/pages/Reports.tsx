import { useState } from 'react'
import type { TrendsResponse } from '@fold/shared'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { useApi } from '../api'
import { useMe } from '../App'
import { fmtMoney, fmtMonthShort } from '../format'
import { Avatar, Card, CardTitle, cls } from '../ui'

function CashFlowChart({ months }: { months: TrendsResponse['months'] }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.income_cents, m.spent_cents)))
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-slate-300" /> Income
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-violet-500" /> Spent
        </span>
      </div>
      <div className="flex h-44 items-end justify-between gap-2">
        {months.map((month) => {
          const saved = month.income_cents - month.spent_cents
          return (
            <div key={month.month} className="group flex flex-1 flex-col items-center gap-1">
              <div className="flex h-36 w-full items-end justify-center gap-1">
                <div
                  title={`Income ${fmtMoney(month.income_cents)}`}
                  className="w-3.5 rounded-t bg-slate-200"
                  style={{ height: `${Math.max(2, (month.income_cents / max) * 100)}%` }}
                />
                <div
                  title={`Spent ${fmtMoney(month.spent_cents)} · kept ${fmtMoney(saved)}`}
                  className={cls('w-3.5 rounded-t', saved < 0 ? 'bg-red-400' : 'bg-violet-500')}
                  style={{ height: `${Math.max(2, (month.spent_cents / max) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] font-medium text-slate-500">{fmtMonthShort(month.month)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Reports() {
  const { me } = useMe()
  const [range, setRange] = useState<6 | 12>(6)
  const { data } = useApi<TrendsResponse>(`/budget-trends?months=${range}`)
  if (!data) return null

  const totals = data.months.reduce(
    (acc, month) => ({
      income: acc.income + month.income_cents,
      spent: acc.spent + month.spent_cents,
    }),
    { income: 0, spent: 0 },
  )
  const kept = totals.income - totals.spent
  const savingsRate = totals.income > 0 ? Math.round((kept / totals.income) * 100) : 0
  const groupTotal = data.by_group.reduce((sum, g) => sum + g.spent_cents, 0)

  const memberTotals = me.household.members.map((member) => ({
    member,
    total: data.months.reduce((sum, month) => sum + (month.member_share_cents[member.id] ?? 0), 0),
  }))
  const memberTotal = memberTotals.reduce((sum, m) => sum + m.total, 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-slate-500">Cash flow, where it went, and who spent it.</p>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-1 text-sm font-medium">
          {([6, 12] as const).map((value) => (
            <button
              key={value}
              onClick={() => setRange(value)}
              className={cls('rounded-lg px-3 py-1.5', range === value ? 'bg-white shadow-sm' : 'text-slate-500')}
            >
              {value} months
            </button>
          ))}
        </div>
      </div>

      <Card>
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Income</p>
            <p className="text-xl font-bold tabular-nums">{fmtMoney(totals.income)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Spent</p>
            <p className="text-xl font-bold tabular-nums">{fmtMoney(totals.spent)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Kept</p>
            <p className={cls('text-xl font-bold tabular-nums', kept >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {fmtMoney(kept)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Savings rate</p>
            <p className={cls('text-xl font-bold tabular-nums', savingsRate >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {savingsRate}%
            </p>
          </div>
        </div>
        <CashFlowChart months={data.months} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle>Where it went</CardTitle>
          <ul className="space-y-2">
            {[...data.by_group]
              .sort((a, b) => b.spent_cents - a.spent_cents)
              .map((group) => (
                <li key={group.name} className="flex items-center gap-2 text-sm">
                  <span className="w-32 truncate text-slate-600">
                    {group.emoji} {group.name}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="block h-full rounded-full bg-violet-400"
                      style={{ width: `${groupTotal > 0 ? (group.spent_cents / groupTotal) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="w-20 text-right text-xs tabular-nums text-slate-500">
                    {fmtMoney(group.spent_cents, { whole: true })}
                  </span>
                  <span className="w-10 text-right text-xs tabular-nums text-slate-400">
                    {groupTotal > 0 ? Math.round((group.spent_cents / groupTotal) * 100) : 0}%
                  </span>
                </li>
              ))}
          </ul>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardTitle>Who spent it</CardTitle>
            <p className="mb-3 text-xs text-slate-500">
              By each person's <em>share</em> of every split — not who happened to swipe the card.
            </p>
            {memberTotal > 0 && (
              <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
                {memberTotals.map(({ member, total }) => (
                  <div
                    key={member.id}
                    title={`${member.name}: ${fmtMoney(total)}`}
                    style={{ width: `${(total / memberTotal) * 100}%`, backgroundColor: member.color }}
                  />
                ))}
              </div>
            )}
            <ul className="space-y-2">
              {memberTotals.map(({ member, total }) => (
                <li key={member.id} className="flex items-center gap-2.5 text-sm">
                  <Avatar name={member.name} color={member.color} size={24} />
                  <span className="flex-1">{member.name}</span>
                  <span className="font-medium tabular-nums">{fmtMoney(total)}</span>
                  <span className="w-10 text-right text-xs tabular-nums text-slate-400">
                    {memberTotal > 0 ? Math.round((total / memberTotal) * 100) : 0}%
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardTitle>Biggest changes vs last month</CardTitle>
            {data.movers.length === 0 ? (
              <p className="text-sm text-slate-400">Not enough history yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.movers.map((mover) => {
                  const delta = mover.spent_cents - mover.prev_spent_cents
                  return (
                    <li key={mover.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate text-slate-600">
                        {mover.emoji} {mover.name}
                      </span>
                      <span className="text-xs tabular-nums text-slate-400">
                        {fmtMoney(mover.prev_spent_cents, { whole: true })} → {fmtMoney(mover.spent_cents, { whole: true })}
                      </span>
                      <span
                        className={cls(
                          'inline-flex w-20 items-center justify-end gap-1 text-xs font-medium tabular-nums',
                          delta > 0 ? 'text-red-500' : 'text-emerald-600',
                        )}
                      >
                        {delta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {fmtMoney(Math.abs(delta))}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
