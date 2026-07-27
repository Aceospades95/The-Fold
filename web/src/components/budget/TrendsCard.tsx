import type { TrendsResponse } from '@fold/shared'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { useApi } from '../../api'
import { fmtMoney, fmtMonthShort } from '../../format'
import { Card, CardTitle, cls } from '../../ui'

export default function TrendsCard() {
  const { data } = useApi<TrendsResponse>('/budget-trends?months=6')
  if (!data || data.months.length === 0) return null

  const max = Math.max(1, ...data.months.map((m) => Math.max(m.allocated_cents, m.spent_cents)))
  const topGroups = [...data.by_group].sort((a, b) => b.spent_cents - a.spent_cents).slice(0, 5)
  const groupTotal = topGroups.reduce((sum, g) => sum + g.spent_cents, 0)

  return (
    <Card>
      <CardTitle>Trends</CardTitle>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="mb-2 flex items-center gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-slate-300" /> Budgeted
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-violet-500" /> Spent
            </span>
          </div>
          <div className="flex h-40 items-end justify-between gap-3">
            {data.months.map((month) => {
              const over = month.spent_cents > month.allocated_cents && month.allocated_cents > 0
              return (
                <div key={month.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-32 w-full items-end justify-center gap-1">
                    <div
                      title={`Budgeted ${fmtMoney(month.allocated_cents)}`}
                      className="w-4 rounded-t bg-slate-200"
                      style={{ height: `${Math.max(2, (month.allocated_cents / max) * 100)}%` }}
                    />
                    <div
                      title={`Spent ${fmtMoney(month.spent_cents)}`}
                      className={cls('w-4 rounded-t', over ? 'bg-red-400' : 'bg-violet-500')}
                      style={{ height: `${Math.max(2, (month.spent_cents / max) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-slate-500">{fmtMonthShort(month.month)}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Where it went</p>
            <ul className="space-y-1.5">
              {topGroups.map((group) => (
                <li key={group.name} className="flex items-center gap-2 text-sm">
                  <span className="w-28 truncate text-slate-600">
                    {group.emoji} {group.name}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="block h-full rounded-full bg-violet-400"
                      style={{ width: `${groupTotal > 0 ? (group.spent_cents / groupTotal) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="w-16 text-right text-xs tabular-nums text-slate-500">
                    {fmtMoney(group.spent_cents, { whole: true })}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {data.movers.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Biggest changes vs last month
              </p>
              <ul className="space-y-1">
                {data.movers.slice(0, 4).map((mover) => {
                  const delta = mover.spent_cents - mover.prev_spent_cents
                  return (
                    <li key={mover.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate text-slate-600">
                        {mover.emoji} {mover.name}
                      </span>
                      <span
                        className={cls(
                          'inline-flex items-center gap-1 text-xs font-medium tabular-nums',
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
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
