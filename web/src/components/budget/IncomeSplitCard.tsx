import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { IncomeSummaryResponse } from '@fold/shared'
import { ChevronDown, ChevronRight, Scale } from 'lucide-react'
import { api, useApi } from '../../api'
import { fmtMoney } from '../../format'
import { Avatar, Card, cls } from '../../ui'

/**
 * Answers "are we splitting on gross or net?" with real numbers: each
 * person's paycheck waterfall, and what every rule would cost them this month.
 */
export default function IncomeSplitCard({ month, onChanged }: { month: string; onChanged: () => void }) {
  const { data, reload } = useApi<IncomeSummaryResponse>(`/income/summary?month=${month}`)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!data || data.members.length < 2) return null

  async function pick(key: 'equal' | 'net' | 'gross'): Promise<void> {
    if (busy || data!.active_key === key) return
    setBusy(true)
    try {
      await api.patch('/household', {
        split_rule: key === 'equal' ? 'equal' : 'proportional',
        split_basis: key === 'gross' ? 'gross' : 'net',
      })
      reload()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const anyBreakdown = data.members.some((m) => m.has_breakdown)

  return (
    <Card className="!p-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-5 py-3.5 text-left"
      >
        <span className="flex items-center gap-2 font-semibold">
          <Scale size={16} className="text-slate-400" />
          Paychecks &amp; how we split
        </span>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          {data.active_key === 'custom'
            ? 'custom percentages'
            : data.options
                .find((o) => o.key === data.active_key)
                ?.shares.map((s) => `${s.pct}%`)
                .join(' / ')}
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {data.members.map((member) => (
              <div key={member.user_id} className="rounded-xl border border-slate-200 p-3.5">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Avatar name={member.name} color={member.color} size={22} /> {member.name}
                </p>
                {member.has_breakdown ? (
                  <dl className="space-y-1 text-sm tabular-nums">
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Gross</dt>
                      <dd className="font-medium">{fmtMoney(member.gross_cents)}</dd>
                    </div>
                    {member.tax_cents > 0 && (
                      <div className="flex justify-between text-slate-500">
                        <dt>− Taxes</dt>
                        <dd>{fmtMoney(member.tax_cents)}</dd>
                      </div>
                    )}
                    {member.pretax_cents > 0 && (
                      <div className="flex justify-between text-slate-500">
                        <dt>− Pre-tax (401k, insurance…)</dt>
                        <dd>{fmtMoney(member.pretax_cents)}</dd>
                      </div>
                    )}
                    {member.posttax_cents > 0 && (
                      <div className="flex justify-between text-slate-500">
                        <dt>− Post-tax</dt>
                        <dd>{fmtMoney(member.posttax_cents)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-slate-100 pt-1 font-semibold">
                      <dt>Take-home</dt>
                      <dd className="text-emerald-600">{fmtMoney(member.net_cents)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-slate-500">
                    {fmtMoney(member.net_cents)} / mo take-home.{' '}
                    <Link to="/settings" className="text-violet-600 hover:underline">
                      Add the paycheck breakdown
                    </Link>{' '}
                    to compare gross vs net.
                  </p>
                )}
              </div>
            ))}
          </div>

          <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
            What each rule means for this month’s {fmtMoney(data.shared_allocated_cents)} shared budget
          </p>
          <div className="space-y-1.5">
            {data.options.map((option) => {
              const active = data.active_key === option.key
              const disabled = option.key === 'gross' && !anyBreakdown
              return (
                <button
                  key={option.key}
                  onClick={() => void pick(option.key)}
                  disabled={disabled}
                  title={disabled ? 'Add a paycheck breakdown first — gross equals net right now' : undefined}
                  className={cls(
                    'flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
                    active
                      ? 'border-violet-400 bg-violet-50/70'
                      : 'border-slate-200 hover:border-slate-300 disabled:opacity-50',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {active && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />}
                    {option.label}
                  </span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-slate-600">
                    {option.shares.map((share) => {
                      const member = data.members.find((m) => m.user_id === share.user_id)
                      return (
                        <span key={share.user_id} className="inline-flex items-center gap-1.5">
                          {member && <Avatar name={member.name} color={member.color} size={18} />}
                          {share.pct}% · {fmtMoney(share.contribution_cents)}
                        </span>
                      )
                    })}
                  </span>
                </button>
              )
            })}
            {data.active_key === 'custom' && (
              <p className="text-xs text-slate-500">
                You’re on custom percentages (set in{' '}
                <Link to="/settings" className="text-violet-600 hover:underline">
                  Settings
                </Link>
                ) — picking an option above switches away from them.
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
