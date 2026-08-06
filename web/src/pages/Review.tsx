import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ReviewResponse } from '@fold/shared'
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, PartyPopper, TrendingUp } from 'lucide-react'
import { useApi } from '../api'
import { useMe } from '../App'
import { currentMonth, fmtMoney, fmtMonth, shiftMonth, todayStr } from '../format'
import { Avatar, Card, CardTitle, Chip, EmptyState, cls } from '../ui'

/** Reviewing "last month" is the natural default during the first week of a new one. */
function defaultMonth(): string {
  const dayOfMonth = Number(todayStr().slice(8, 10))
  return dayOfMonth <= 7 ? shiftMonth(currentMonth(), -1) : currentMonth()
}

function DeltaChip({ delta, invert = false }: { delta: number; invert?: boolean }) {
  if (delta === 0) return null
  const good = invert ? delta < 0 : delta > 0
  return (
    <span
      className={cls(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
        good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600',
      )}
    >
      {delta > 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {fmtMoney(Math.abs(delta))}
    </span>
  )
}

function HighlightList({
  title,
  emoji,
  tone,
  items,
  suffix,
}: {
  title: string
  emoji: string
  tone: 'good' | 'bad' | 'neutral'
  items: ReviewResponse['wins']
  suffix: string
}) {
  if (items.length === 0) return null
  return (
    <Card>
      <CardTitle>
        {emoji} {title} <span className="font-normal normal-case text-slate-400">— {suffix}</span>
      </CardTitle>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.category_id} className="flex items-center gap-2 text-sm">
            <span>{item.emoji ?? '🏷️'}</span>
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            <span
              className={cls(
                'font-semibold tabular-nums',
                tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-slate-600',
              )}
            >
              {fmtMoney(item.amount_cents)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default function Review() {
  const { me } = useMe()
  const [month, setMonth] = useState(defaultMonth)
  const { data } = useApi<ReviewResponse>(`/review/${month}`)
  const members = me.household.members

  const shareTotal = useMemo(
    () => (data ? data.members.reduce((sum, m) => sum + m.share_cents, 0) : 0),
    [data],
  )

  if (!data) return null

  const anythingHappened = data.transactions_count > 0 || data.income_cents > 0
  const spentPct = data.income_cents > 0 ? Math.min(100, Math.round((data.spent_cents / data.income_cents) * 100)) : 0
  const topMax = Math.max(1, ...data.top_categories.map((c) => c.spent_cents))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Month in review</h1>
          <p className="text-sm text-slate-500">How {fmtMonth(data.month)} actually went.</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            disabled={!data.has_prev}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronLeft size={17} />
          </button>
          <span className="w-32 text-center text-sm font-semibold">{fmtMonth(month)}</span>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={!data.has_next}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>

      {!anythingHappened ? (
        <EmptyState emoji="🗓️" title={`Nothing recorded in ${fmtMonth(data.month)}`}>
          Once there’s income or spending here, the recap writes itself.
        </EmptyState>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">The headline</p>
                {data.income_cents > 0 ? (
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    Kept {fmtMoney(data.kept_cents)}
                    <span className="text-sm font-normal text-slate-400"> of {fmtMoney(data.income_cents)} income</span>
                  </p>
                ) : (
                  <p className="mt-1 text-2xl font-bold tabular-nums">Spent {fmtMoney(data.spent_cents)}</p>
                )}
              </div>
              {data.savings_rate != null && (
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Savings rate</p>
                  <p className={cls('text-2xl font-bold tabular-nums', data.savings_rate >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {data.savings_rate}%
                  </p>
                </div>
              )}
            </div>
            {data.income_cents > 0 && (
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-emerald-100">
                <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${spentPct}%` }} />
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
              <span>
                Spent <strong className="tabular-nums">{fmtMoney(data.spent_cents)}</strong>
                {data.vs_prev && <DeltaChip delta={data.vs_prev.spent_delta_cents} invert />}
              </span>
              <span>
                Shared <strong className="tabular-nums">{fmtMoney(data.shared_spent_cents)}</strong>
              </span>
              <span>
                {data.transactions_count} transaction{data.transactions_count === 1 ? '' : 's'}
              </span>
              {data.net_worth_delta_cents != null && (
                <span className="inline-flex items-center gap-1">
                  <TrendingUp size={13} className="text-slate-400" />
                  Net worth {data.net_worth_delta_cents >= 0 ? 'up' : 'down'}{' '}
                  <strong className={cls('tabular-nums', data.net_worth_delta_cents >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {fmtMoney(Math.abs(data.net_worth_delta_cents))}
                  </strong>
                </span>
              )}
            </div>
            {data.uncategorized_count > 0 && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                {data.uncategorized_count} transaction{data.uncategorized_count === 1 ? '' : 's'} here{' '}
                {data.uncategorized_count === 1 ? 'is' : 'are'} still uncategorized —{' '}
                <Link to="/transactions?needs=category" className="underline">
                  classify them
                </Link>{' '}
                and these numbers sharpen up.
              </p>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle>Who spent what</CardTitle>
              <p className="mb-2 text-xs text-slate-400">By each person’s share of every split.</p>
              {shareTotal > 0 && (
                <div className="mb-3 flex h-2.5 overflow-hidden rounded-full">
                  {data.members.map((m) => {
                    const member = members.find((x) => x.id === m.user_id)
                    return (
                      <div
                        key={m.user_id}
                        style={{ width: `${(m.share_cents / shareTotal) * 100}%`, backgroundColor: member?.color }}
                      />
                    )
                  })}
                </div>
              )}
              <ul className="space-y-2">
                {data.members.map((m) => (
                  <li key={m.user_id} className="flex items-center gap-2.5 text-sm">
                    <Avatar name={m.name} color={m.color} size={24} />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <span className="text-xs text-slate-400">
                      {shareTotal > 0 ? Math.round((m.share_cents / shareTotal) * 100) : 0}%
                    </span>
                    <span className="font-semibold tabular-nums">{fmtMoney(m.share_cents)}</span>
                  </li>
                ))}
              </ul>
              {data.balance && (
                <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  Running balance:{' '}
                  <strong>
                    {members.find((m) => m.id === data.balance!.from_user_id)?.name ?? '?'} owes{' '}
                    {members.find((m) => m.id === data.balance!.to_user_id)?.name ?? '?'}{' '}
                    {fmtMoney(data.balance.amount_cents)}
                  </strong>{' '}
                  —{' '}
                  <Link to="/transactions" className="underline">
                    settle up
                  </Link>
                </p>
              )}
            </Card>

            <Card>
              <CardTitle>Where it went</CardTitle>
              <ul className="space-y-2">
                {data.top_categories.map((c) => (
                  <li key={c.category_id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span>{c.emoji ?? '🏷️'}</span>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="font-semibold tabular-nums">{fmtMoney(c.spent_cents)}</span>
                      {c.allocated_cents > 0 && (
                        <span className="w-20 text-right text-xs text-slate-400">of {fmtMoney(c.allocated_cents, { whole: true })}</span>
                      )}
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cls('h-full rounded-full', c.allocated_cents > 0 && c.spent_cents > c.allocated_cents ? 'bg-red-400' : 'bg-[var(--color-accent)]')}
                        style={{ width: `${Math.min(100, (c.spent_cents / topMax) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <HighlightList title="Came in under" emoji="🎉" tone="good" items={data.wins} suffix="left unspent" />
            <HighlightList title="Went over" emoji="🚨" tone="bad" items={data.overspent} suffix="over budget" />
            <HighlightList title="Rolls forward" emoji="🐿️" tone="neutral" items={data.rolled_forward} suffix="into next month" />
          </div>

          {data.biggest_purchases.length > 0 && (
            <Card>
              <CardTitle>Biggest purchases</CardTitle>
              <ul className="divide-y divide-slate-100">
                {data.biggest_purchases.map((tx) => {
                  const payer = members.find((m) => m.id === tx.payer_user_id)
                  return (
                    <li key={tx.id} className="flex items-center gap-3 py-2 text-sm">
                      {payer && <Avatar name={payer.name} color={payer.color} size={24} />}
                      <span className="min-w-0 flex-1 truncate">{tx.merchant_name ?? tx.description}</span>
                      <span className="text-xs text-slate-400">{tx.date.slice(8, 10)} {fmtMonth(data.month).split(' ')[0].slice(0, 3)}</span>
                      <span className="font-semibold tabular-nums">{fmtMoney(tx.amount_cents)}</span>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}

          {data.wins.length > 0 && data.overspent.length === 0 && (
            <p className="flex items-center justify-center gap-2 pb-2 text-sm font-medium text-emerald-600">
              <PartyPopper size={16} /> Not a single envelope in the red. Well played.
            </p>
          )}
        </>
      )}
    </div>
  )
}
