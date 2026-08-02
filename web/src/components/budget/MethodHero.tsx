import type { BudgetResponse } from '@fold/shared'
import { PiggyBank, Wallet } from 'lucide-react'
import { fmtMoney } from '../../format'
import { Card, ProgressBar, cls } from '../../ui'

const BUCKET_COLORS: Record<string, string> = {
  need: 'var(--color-accent)',
  want: '#f59e0b',
  save: '#10b981',
}

/** 50/30/20 view: three percentage buckets against take-home income. */
function FiftyThirtyTwenty({ data }: { data: BudgetResponse }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {data.buckets.map((bucket) => {
        // Needs & wants are judged on spending; savings on money put away.
        const value = bucket.key === 'save' ? bucket.allocated_cents : bucket.spent_cents
        const verb = bucket.key === 'save' ? 'put away' : 'spent'
        const over = value > bucket.target_cents && bucket.target_cents > 0
        const remaining = bucket.target_cents - value
        return (
          <Card key={bucket.key}>
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-semibold">{bucket.label}</p>
              <p className="text-xs font-medium text-slate-400">{bucket.pct}% of take-home</p>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {fmtMoney(value)}
              <span className="text-sm font-normal text-slate-400"> of {fmtMoney(bucket.target_cents)}</span>
            </p>
            <ProgressBar value={value} max={bucket.target_cents} color={BUCKET_COLORS[bucket.key]} className="mt-2" />
            <p className={cls('mt-1.5 text-xs tabular-nums', over ? 'font-medium text-red-600' : 'text-slate-500')}>
              {over
                ? `${fmtMoney(-remaining)} over the ${bucket.pct}% line`
                : bucket.key === 'save'
                  ? `${fmtMoney(Math.max(0, remaining))} more to hit the goal`
                  : `${fmtMoney(remaining)} of headroom ${verb === 'spent' ? 'left' : ''}`}
            </p>
          </Card>
        )
      })}
    </div>
  )
}

/** Pay-yourself-first: fund savings, then spend the rest without guilt. */
function PayYourselfFirst({ data }: { data: BudgetResponse }) {
  const save = data.buckets.find((b) => b.key === 'save')!
  const target = data.method_config.savings_target_cents ?? save.target_cents
  const putAway = save.allocated_cents
  const spendable = Math.max(0, data.combined_income_cents - target)
  const spent = data.buckets.filter((b) => b.key !== 'save').reduce((sum, b) => sum + b.spent_cents, 0)
  const left = spendable - spent
  const funded = target > 0 ? putAway >= target : true

  return (
    <Card className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <PiggyBank size={15} className="text-emerald-600" /> Pay yourselves first
          </p>
          <p className={cls('text-sm font-bold tabular-nums', funded ? 'text-emerald-600' : 'text-slate-700')}>
            {fmtMoney(putAway)} <span className="font-normal text-slate-400">of {fmtMoney(target)}</span>
          </p>
        </div>
        <ProgressBar value={putAway} max={target} color="#10b981" />
        <p className="mt-1 text-xs text-slate-500">
          {funded
            ? 'Savings funded — everything below is guilt-free. 🎉'
            : `Put ${fmtMoney(target - putAway)} more into savings envelopes (Travel, Emergency fund…) to hit this month's goal.`}
        </p>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Wallet size={15} className="text-slate-400" /> Spend the rest
          </p>
          <p className={cls('text-sm font-bold tabular-nums', left < 0 ? 'text-red-600' : 'text-slate-700')}>
            {fmtMoney(spent)} <span className="font-normal text-slate-400">of {fmtMoney(spendable)}</span>
          </p>
        </div>
        <ProgressBar value={spent} max={spendable} />
        <p className={cls('mt-1 text-xs', left < 0 ? 'font-medium text-red-600' : 'text-slate-500')}>
          {left >= 0 ? `${fmtMoney(left)} left to spend this month` : `${fmtMoney(-left)} over — dipping into savings`}
        </p>
      </div>
    </Card>
  )
}

/** Tracker: no envelopes required — income in, spending out, what you kept. */
function Tracker({ data }: { data: BudgetResponse }) {
  const income = data.combined_income_cents
  const spent = data.total_spent_cents
  const kept = income - spent
  const rate = income > 0 ? Math.round((kept / income) * 100) : 0
  const top = [...data.categories]
    .filter((c) => c.spent_cents > 0)
    .sort((a, b) => b.spent_cents - a.spent_cents)
    .slice(0, 5)

  return (
    <Card>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Income this month</p>
          <p className="text-xl font-bold tabular-nums">{fmtMoney(income)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Spent so far</p>
          <p className="text-xl font-bold tabular-nums">{fmtMoney(spent)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Kept</p>
          <p className={cls('text-xl font-bold tabular-nums', kept >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {fmtMoney(kept)} <span className="text-sm font-medium text-slate-400">({rate}%)</span>
          </p>
        </div>
      </div>
      <ProgressBar value={spent} max={income} className="mt-3" />
      {top.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {top.map((category) => (
            <span key={category.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {category.emoji} {category.name} · {fmtMoney(category.spent_cents)}
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Tracking mode — no envelopes needed. Assign amounts below anytime if you want limits back.
      </p>
    </Card>
  )
}

export default function MethodHero({ data }: { data: BudgetResponse }) {
  switch (data.budget_method) {
    case 'fifty_thirty_twenty':
      return <FiftyThirtyTwenty data={data} />
    case 'pay_yourself_first':
      return <PayYourselfFirst data={data} />
    case 'tracker':
      return <Tracker data={data} />
    default:
      return null
  }
}
