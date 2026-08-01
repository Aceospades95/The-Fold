import type { Category, Member, Split, SplitRule } from '@fold/shared'
import { splitByWeights, splitEqual } from '@fold/shared'
import { fmtMoney } from '../format'
import { Avatar, MoneyInput, cls } from '../ui'

export type SplitMode = 'none' | 'equal' | 'income' | 'owed' | 'by_category' | 'custom'

export interface SplitLine {
  category_id: string | ''
  amount_cents: number | null
}

const MODE_LABELS: { value: SplitMode; label: string; title?: string }[] = [
  { value: 'none', label: 'No split' },
  { value: 'equal', label: '50 / 50' },
  { value: 'income', label: 'By income' },
  { value: 'owed', label: 'They owe it all' },
  { value: 'by_category', label: 'By category', title: 'Personal categories go to their owner; shared ones are split by your household rule' },
  { value: 'custom', label: 'Custom' },
]

function weightsFor(members: Member[], rule: SplitRule): { user_id: string; weight: number }[] {
  return members.map((m) => ({
    user_id: m.id,
    weight: rule === 'proportional' ? m.monthly_income_cents : 1,
  }))
}

/**
 * Derive who owes what from the category breakdown: a line in someone's
 * personal category is theirs alone; shared lines split by the household rule.
 */
export function splitsFromLines(
  lines: SplitLine[],
  categories: Category[],
  members: Member[],
  rule: SplitRule,
): Split[] | null {
  const totals = new Map<string, number>(members.map((m) => [m.id, 0]))
  for (const line of lines) {
    if (line.amount_cents == null || line.amount_cents <= 0) return null
    const category = categories.find((c) => c.id === line.category_id)
    if (category?.scope === 'personal' && category.owner_user_id) {
      totals.set(category.owner_user_id, (totals.get(category.owner_user_id) ?? 0) + line.amount_cents)
    } else {
      for (const share of splitByWeights(line.amount_cents, weightsFor(members, rule))) {
        totals.set(share.user_id, (totals.get(share.user_id) ?? 0) + share.share_cents)
      }
    }
  }
  return [...totals.entries()]
    .filter(([, share_cents]) => share_cents > 0)
    .map(([user_id, share_cents]) => ({ user_id, share_cents }))
}

export function computeSplits(
  amountCents: number | null,
  mode: SplitMode,
  payerId: string,
  members: Member[],
  custom: Record<string, number | null>,
  context?: { lines?: SplitLine[]; categories?: Category[]; rule?: SplitRule },
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
    case 'by_category': {
      if (!context?.lines || !context.categories) return null
      const splits = splitsFromLines(context.lines, context.categories, members, context.rule ?? 'proportional')
      if (!splits) return null
      const total = splits.reduce((sum, s) => sum + s.share_cents, 0)
      return total === amountCents ? splits : null
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

function matches(splits: Split[], candidate: Split[] | null): boolean {
  if (!candidate || candidate.length !== splits.length) return false
  return candidate.every((c) => splits.some((s) => s.user_id === c.user_id && Math.abs(s.share_cents - c.share_cents) <= 1))
}

/** Infer the closest mode for an existing transaction's splits (used when editing). */
export function inferMode(
  splits: Split[],
  payerId: string,
  members: Member[],
  context?: { lines?: SplitLine[]; categories?: Category[]; rule?: SplitRule },
): SplitMode {
  if (splits.length === 1) {
    return splits[0].user_id === payerId ? 'none' : 'owed'
  }
  const amount = splits.reduce((sum, s) => sum + s.share_cents, 0)
  if ((context?.lines?.length ?? 0) > 1 && context?.categories) {
    const fromLines = splitsFromLines(context.lines!, context.categories, members, context.rule ?? 'proportional')
    if (matches(splits, fromLines)) return 'by_category'
  }
  if (matches(splits, splitEqual(amount, members.map((m) => m.id)))) return 'equal'
  if (
    matches(
      splits,
      splitByWeights(amount, members.map((m) => ({ user_id: m.id, weight: m.monthly_income_cents }))),
    )
  ) {
    return 'income'
  }
  return 'custom'
}

export function SplitEditor({
  amountCents,
  payerId,
  members,
  mode,
  custom,
  onMode,
  onCustom,
  context,
}: {
  amountCents: number | null
  payerId: string
  members: Member[]
  mode: SplitMode
  custom: Record<string, number | null>
  onMode: (mode: SplitMode) => void
  onCustom: (userId: string, cents: number | null) => void
  context?: { lines?: SplitLine[]; categories?: Category[]; rule?: SplitRule }
}) {
  const preview = computeSplits(amountCents, mode, payerId, members, custom, context)
  const customTotal = members.reduce((sum, m) => sum + (custom[m.id] ?? 0), 0)
  const multiLine = (context?.lines?.length ?? 0) > 1
  const modes =
    members.length > 1
      ? MODE_LABELS.filter((m) => m.value !== 'by_category' || multiLine)
      : MODE_LABELS.filter((m) => m.value === 'none')

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {modes.map(({ value, label, title }) => (
          <button
            key={value}
            type="button"
            title={title}
            onClick={() => onMode(value)}
            className={cls(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              mode === value
                ? 'border-violet-600 bg-violet-600 text-on-accent'
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
        members.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            {preview ? (
              preview.map((s) => {
                const member = members.find((m) => m.id === s.user_id)
                if (!member) return null
                return (
                  <span key={s.user_id} className="inline-flex items-center gap-1.5">
                    <Avatar name={member.name} color={member.color} size={20} />
                    {fmtMoney(s.share_cents)}
                  </span>
                )
              })
            ) : mode === 'by_category' ? (
              <span className="text-xs text-amber-600">
                Finish assigning every category amount to see the split.
              </span>
            ) : null}
          </div>
        )
      )}
    </div>
  )
}
