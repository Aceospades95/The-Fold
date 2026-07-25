import type { Member, Split } from '@fold/shared'
import { splitByWeights, splitEqual } from '@fold/shared'
import { fmtMoney } from '../format'
import { Avatar, MoneyInput, cls } from '../ui'

export type SplitMode = 'none' | 'equal' | 'income' | 'owed' | 'custom'

const MODE_LABELS: { value: SplitMode; label: string }[] = [
  { value: 'none', label: 'No split' },
  { value: 'equal', label: '50 / 50' },
  { value: 'income', label: 'By income' },
  { value: 'owed', label: 'They owe it all' },
  { value: 'custom', label: 'Custom' },
]

export function computeSplits(
  amountCents: number | null,
  mode: SplitMode,
  payerId: string,
  members: Member[],
  custom: Record<string, number | null>,
): Split[] | null {
  if (amountCents == null || amountCents <= 0) return null
  switch (mode) {
    case 'none':
      return [{ user_id: payerId, share_cents: amountCents }]
    case 'equal':
      return splitEqual(amountCents, members.map((m) => m.id))
    case 'income':
      return splitByWeights(
        amountCents,
        members.map((m) => ({ user_id: m.id, weight: m.monthly_income_cents })),
      )
    case 'owed': {
      const others = members.filter((m) => m.id !== payerId)
      if (others.length === 0) return null
      return splitEqual(amountCents, others.map((m) => m.id))
    }
    case 'custom': {
      const splits = members
        .map((m) => ({ user_id: m.id, share_cents: custom[m.id] ?? 0 }))
        .filter((s) => s.share_cents > 0)
      const total = splits.reduce((sum, s) => sum + s.share_cents, 0)
      if (splits.length === 0 || total !== amountCents) return null
      return splits
    }
  }
}

/** Infer the closest mode for an existing transaction's splits (used when editing). */
export function inferMode(splits: Split[], payerId: string, members: Member[]): SplitMode {
  if (splits.length === 1) {
    return splits[0].user_id === payerId ? 'none' : 'owed'
  }
  const amount = splits.reduce((sum, s) => sum + s.share_cents, 0)
  const equal = splitEqual(amount, members.map((m) => m.id))
  const matchesEqual =
    splits.length === equal.length &&
    equal.every((e) => splits.some((s) => s.user_id === e.user_id && Math.abs(s.share_cents - e.share_cents) <= 1))
  return matchesEqual ? 'equal' : 'custom'
}

export function SplitEditor({
  amountCents,
  payerId,
  members,
  mode,
  custom,
  onMode,
  onCustom,
}: {
  amountCents: number | null
  payerId: string
  members: Member[]
  mode: SplitMode
  custom: Record<string, number | null>
  onMode: (mode: SplitMode) => void
  onCustom: (userId: string, cents: number | null) => void
}) {
  const preview = computeSplits(amountCents, mode, payerId, members, custom)
  const customTotal = members.reduce((sum, m) => sum + (custom[m.id] ?? 0), 0)
  const modes = members.length > 1 ? MODE_LABELS : MODE_LABELS.filter((m) => m.value === 'none')

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {modes.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => onMode(value)}
            className={cls(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              mode === value
                ? 'border-violet-600 bg-violet-600 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'custom' ? (
        <div className="mt-3 space-y-2">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <Avatar name={m.name} color={m.color} size={24} />
              <span className="w-20 truncate text-sm">{m.name}</span>
              <MoneyInput cents={custom[m.id] ?? null} onCents={(cents) => onCustom(m.id, cents)} className="flex-1" />
            </div>
          ))}
          {amountCents != null && customTotal !== amountCents && (
            <p className="text-xs text-amber-600">
              Shares add up to {fmtMoney(customTotal)} — they need to total {fmtMoney(amountCents)}.
            </p>
          )}
        </div>
      ) : (
        preview &&
        members.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            {preview.map((s) => {
              const member = members.find((m) => m.id === s.user_id)
              if (!member) return null
              return (
                <span key={s.user_id} className="inline-flex items-center gap-1.5">
                  <Avatar name={member.name} color={member.color} size={20} />
                  {fmtMoney(s.share_cents)}
                </span>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
