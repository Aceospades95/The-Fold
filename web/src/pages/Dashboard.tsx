import { Link } from 'react-router-dom'
import type { SummaryResponse } from '@fold/shared'
import { ArrowRight, MapPin } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { fmtDate, fmtMoney, fmtMonth, fmtRange } from '../format'
import { Avatar, Card, CardTitle, Chip, EmptyState, ProgressBar } from '../ui'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  const { me } = useMe()
  const { data, reload } = useApi<SummaryResponse>('/summary')
  if (!data) return null

  const members = me.household.members
  const partner = members.find((m) => m.id !== me.user.id)
  const suggestion = data.balances.suggestion
  const iOwe = suggestion && suggestion.from_user_id === me.user.id
  const owedToMe = suggestion && suggestion.to_user_id === me.user.id

  async function toggleTask(taskId: string): Promise<void> {
    await api.patch(`/list-items/${taskId}`, { done: 1 })
    reload()
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">
          {greeting()}, {me.user.name.split(' ')[0]}
        </h1>
        <p className="text-sm text-slate-500">Here’s where things stand for {fmtMonth(data.month)}.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle
            action={
              <Link to="/budget" className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline">
                Budget <ArrowRight size={12} />
              </Link>
            }
          >
            Shared budget
          </CardTitle>
          <p className="text-2xl font-bold tabular-nums">
            {fmtMoney(data.shared_spent_cents)}
            <span className="text-sm font-normal text-slate-400"> of {fmtMoney(data.shared_allocated_cents)}</span>
          </p>
          <ProgressBar value={data.shared_spent_cents} max={data.shared_allocated_cents} className="mt-3" />
          <p className="mt-2 text-xs text-slate-500">
            {data.shared_allocated_cents > data.shared_spent_cents
              ? `${fmtMoney(data.shared_allocated_cents - data.shared_spent_cents)} left this month`
              : data.shared_allocated_cents > 0
                ? `${fmtMoney(data.shared_spent_cents - data.shared_allocated_cents)} over — time to check in`
                : 'No shared budget set yet'}
          </p>
        </Card>

        <Card>
          <CardTitle>My personal budget</CardTitle>
          <p className="text-2xl font-bold tabular-nums">
            {fmtMoney(data.my_personal_spent_cents)}
            <span className="text-sm font-normal text-slate-400"> of {fmtMoney(data.my_personal_allocated_cents)}</span>
          </p>
          <ProgressBar
            value={data.my_personal_spent_cents}
            max={data.my_personal_allocated_cents}
            color={me.user.color}
            className="mt-3"
          />
          <p className="mt-2 text-xs text-slate-500">Yours alone — no questions asked.</p>
        </Card>

        <Card>
          <CardTitle
            action={
              <Link to="/transactions" className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline">
                Settle up <ArrowRight size={12} />
              </Link>
            }
          >
            Between you two
          </CardTitle>
          {suggestion && partner ? (
            <div className="flex items-center gap-3">
              <Avatar name={partner.name} color={partner.color} size={36} />
              <div>
                <p className="font-semibold">
                  {iOwe && `You owe ${partner.name} ${fmtMoney(suggestion.amount_cents)}`}
                  {owedToMe && `${partner.name} owes you ${fmtMoney(suggestion.amount_cents)}`}
                </p>
                <p className="text-xs text-slate-500">Across everything you’ve split so far</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">✨ You’re all squared up.</p>
          )}
        </Card>

        {data.net_worth && (
          <Card>
            <CardTitle
              action={
                <Link to="/networth" className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline">
                  Net worth <ArrowRight size={12} />
                </Link>
              }
            >
              Net worth
            </CardTitle>
            <p className="text-2xl font-bold tabular-nums">{fmtMoney(data.net_worth.net_cents)}</p>
            <p className="mt-1 text-xs text-slate-500">
              {data.net_worth.delta_month_cents != null ? (
                <span className={data.net_worth.delta_month_cents >= 0 ? 'font-medium text-emerald-600' : 'font-medium text-red-600'}>
                  {data.net_worth.delta_month_cents >= 0 ? '▲' : '▼'} {fmtMoney(Math.abs(data.net_worth.delta_month_cents))} this month
                </span>
              ) : (
                `across ${data.net_worth.account_count} accounts`
              )}
            </p>
          </Card>
        )}

        <Card>
          <CardTitle
            action={
              <Link to="/trips" className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline">
                Trips <ArrowRight size={12} />
              </Link>
            }
          >
            Next adventure
          </CardTitle>
          {data.next_trip ? (
            <Link to={`/trips/${data.next_trip.id}`} className="block">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {data.next_trip.emoji} {data.next_trip.name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin size={12} />
                    {data.next_trip.location ?? 'Somewhere good'} · {fmtRange(data.next_trip.start_date, data.next_trip.end_date)}
                  </p>
                </div>
                {data.next_trip.days_until != null && data.next_trip.days_until >= 0 && (
                  <Chip className="bg-violet-100 text-violet-700">{data.next_trip.days_until} days</Chip>
                )}
              </div>
              <ProgressBar value={data.next_trip.spent_cents} max={data.next_trip.budget_cents} className="mt-3" />
              <p className="mt-2 text-xs text-slate-500">
                {fmtMoney(data.next_trip.spent_cents)} spent of {fmtMoney(data.next_trip.budget_cents)} budget
              </p>
            </Link>
          ) : (
            <p className="text-sm text-slate-500">
              Nothing on the calendar. <Link to="/trips" className="text-violet-600 hover:underline">Dream something up →</Link>
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle
            action={
              <Link to="/lists" className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline">
                Lists <ArrowRight size={12} />
              </Link>
            }
          >
            On my plate
          </CardTitle>
          {data.my_tasks.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing assigned to you. Enjoy it while it lasts. 🙌</p>
          ) : (
            <ul className="space-y-2">
              {data.my_tasks.map((task) => (
                <li key={task.id} className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    onChange={() => void toggleTask(task.id)}
                    className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span className="flex-1 text-sm">{task.text}</span>
                  {task.due_date && <Chip>{fmtDate(task.due_date)}</Chip>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle
            action={
              <Link to="/transactions" className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline">
                All spending <ArrowRight size={12} />
              </Link>
            }
          >
            Recent spending
          </CardTitle>
          {data.recent_transactions.length === 0 ? (
            <EmptyState emoji="🧾" title="No spending yet">Add your first expense on the Spending page.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recent_transactions.map((tx) => {
                const payer = members.find((m) => m.id === tx.payer_user_id)
                return (
                  <li key={tx.id} className="flex items-center gap-3 py-2">
                    {payer && <Avatar name={payer.name} color={payer.color} size={26} />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{tx.description}</p>
                      <p className="text-xs text-slate-500">{fmtDate(tx.date)}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{fmtMoney(tx.amount_cents)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
