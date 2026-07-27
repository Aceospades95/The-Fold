import { useState } from 'react'
import type { Category, Tx } from '@fold/shared'
import { Plus, Split as SplitIcon, X } from 'lucide-react'
import { api } from '../api'
import { useMe } from '../App'
import { fmtMoney, todayStr } from '../format'
import { Avatar, Button, ErrorNote, Field, Modal, MoneyInput, Select, TextInput, cls } from '../ui'
import { SplitEditor, computeSplits, inferMode, type SplitLine, type SplitMode } from './SplitEditor'

export function CategorySelect({
  categories,
  value,
  onChange,
  allowNone,
  className,
}: {
  categories: Category[]
  value: string | ''
  onChange: (id: string | '') => void
  allowNone?: boolean
  className?: string
}) {
  const { me } = useMe()
  const shared = categories.filter((c) => c.scope === 'shared')
  const byOwner = me.household.members
    .map((m) => ({
      member: m,
      cats: categories.filter((c) => c.scope === 'personal' && c.owner_user_id === m.id),
    }))
    .filter((group) => group.cats.length > 0)
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {allowNone && <option value="">No category</option>}
      <optgroup label="Shared">
        {shared.map((c) => (
          <option key={c.id} value={c.id}>
            {c.emoji ? `${c.emoji} ` : ''}
            {c.name}
          </option>
        ))}
      </optgroup>
      {byOwner.map(({ member, cats }) => (
        <optgroup key={member.id} label={`${member.name} — personal`}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji ? `${c.emoji} ` : ''}
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  )
}

export function PayerPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { me } = useMe()
  return (
    <div className="flex gap-2">
      {me.household.members.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onChange(m.id)}
          className={cls(
            'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
            value === m.id ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-slate-300 text-slate-600 hover:border-slate-400',
          )}
        >
          <Avatar name={m.name} color={m.color} size={22} />
          {m.name}
        </button>
      ))}
    </div>
  )
}

/** Assign one purchase across several categories — $100 food, $200 household. */
export function LineEditor({
  lines,
  categories,
  amountCents,
  onChange,
}: {
  lines: SplitLine[]
  categories: Category[]
  amountCents: number | null
  onChange: (lines: SplitLine[]) => void
}) {
  const assigned = lines.reduce((sum, line) => sum + (line.amount_cents ?? 0), 0)
  const remaining = (amountCents ?? 0) - assigned

  function update(index: number, patch: Partial<SplitLine>): void {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  if (lines.length <= 1) {
    return (
      <div className="space-y-1.5">
        <CategorySelect
          categories={categories}
          value={lines[0]?.category_id ?? ''}
          onChange={(id) => onChange([{ category_id: id, amount_cents: amountCents }])}
          allowNone
        />
        <button
          type="button"
          onClick={() =>
            onChange([
              { category_id: lines[0]?.category_id ?? '', amount_cents: null },
              { category_id: '', amount_cents: null },
            ])
          }
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline"
        >
          <SplitIcon size={12} /> Split across categories
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {lines.map((line, index) => (
        <div key={index} className="flex items-center gap-2">
          <CategorySelect
            categories={categories}
            value={line.category_id}
            onChange={(id) => update(index, { category_id: id })}
            allowNone
            className="min-w-0 flex-1"
          />
          <div className="w-28 shrink-0">
            <MoneyInput cents={line.amount_cents} onCents={(cents) => update(index, { amount_cents: cents })} />
          </div>
          {remaining !== 0 && (
            <button
              type="button"
              title={`Assign the remaining ${fmtMoney(remaining)}`}
              onClick={() => update(index, { amount_cents: (line.amount_cents ?? 0) + remaining })}
              className="shrink-0 rounded px-1 text-[10px] font-semibold text-violet-600 hover:bg-violet-50"
            >
              rest
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChange([...lines, { category_id: '', amount_cents: remaining > 0 ? remaining : null }])}
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline"
        >
          <Plus size={12} /> Add category
        </button>
        <span className={cls('text-xs tabular-nums', remaining === 0 ? 'text-emerald-600' : 'text-amber-600')}>
          {remaining === 0 ? 'All assigned ✓' : `${fmtMoney(remaining)} left to assign`}
        </span>
      </div>
    </div>
  )
}

export default function TxModal({
  existing,
  categories,
  onClose,
  onSaved,
}: {
  existing: Tx | null
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}) {
  const { me } = useMe()
  const members = me.household.members
  const [description, setDescription] = useState(existing?.description ?? '')
  const [amount, setAmount] = useState<number | null>(existing?.amount_cents ?? null)
  const [date, setDate] = useState(existing?.date ?? todayStr())
  const [payerId, setPayerId] = useState(existing?.payer_user_id ?? me.user.id)
  const [lines, setLines] = useState<SplitLine[]>(() => {
    if (existing && existing.lines.length > 0) {
      return existing.lines.map((line) => ({ category_id: line.category_id ?? '', amount_cents: line.amount_cents }))
    }
    return [{ category_id: categories.find((c) => c.scope === 'shared')?.id ?? '', amount_cents: existing?.amount_cents ?? null }]
  })
  const [mode, setMode] = useState<SplitMode>(() => {
    if (!existing) return members.length > 1 ? 'equal' : 'none'
    return inferMode(existing.splits, existing.payer_user_id, members, {
      lines: existing.lines.map((line) => ({ category_id: line.category_id ?? '', amount_cents: line.amount_cents })),
      categories,
      rule: me.household.split_rule,
    })
  })
  const [custom, setCustom] = useState<Record<string, number | null>>(() => {
    const initial: Record<string, number | null> = {}
    if (existing) for (const split of existing.splits) initial[split.user_id] = split.share_cents
    return initial
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const multiLine = lines.length > 1
  const linesTotal = lines.reduce((sum, line) => sum + (line.amount_cents ?? 0), 0)
  const linesBalanced = !multiLine || (amount != null && linesTotal === amount && lines.every((l) => (l.amount_cents ?? 0) > 0))
  const splits = computeSplits(amount, mode, payerId, members, custom, {
    lines,
    categories,
    rule: me.household.split_rule,
  })
  const valid = description.trim().length > 0 && amount != null && amount > 0 && splits != null && linesBalanced

  /** Keep a single-category line pinned to the total. */
  function setTotal(cents: number | null): void {
    setAmount(cents)
    if (!multiLine) setLines([{ category_id: lines[0]?.category_id ?? '', amount_cents: cents }])
  }

  async function save(): Promise<void> {
    if (!valid) return
    setBusy(true)
    setError(null)
    const body = {
      date,
      description: description.trim(),
      amount_cents: amount,
      category_id: multiLine ? null : lines[0]?.category_id || null,
      payer_user_id: payerId,
      splits,
      lines: multiLine
        ? lines.map((line) => ({ category_id: line.category_id || null, amount_cents: line.amount_cents! }))
        : undefined,
    }
    try {
      if (existing) await api.patch(`/transactions/${existing.id}`, body)
      else await api.post('/transactions', body)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    if (!existing) return
    setBusy(true)
    try {
      await api.delete(`/transactions/${existing.id}`)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title={existing ? 'Edit expense' : 'Add expense'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <MoneyInput cents={amount} onCents={setTotal} autoFocus={!existing} />
          </Field>
          <Field label="Date">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Groceries, rent, date night…" />
        </Field>
        <Field label={multiLine ? 'Categories' : 'Category'}>
          <LineEditor lines={lines} categories={categories} amountCents={amount} onChange={setLines} />
        </Field>
        <Field label="Paid by">
          <PayerPicker value={payerId} onChange={setPayerId} />
        </Field>
        <Field label="Who owes what">
          <SplitEditor
            amountCents={amount}
            payerId={payerId}
            members={members}
            mode={mode}
            custom={custom}
            onMode={setMode}
            onCustom={(userId, cents) => setCustom((prev) => ({ ...prev, [userId]: cents }))}
            context={{ lines, categories, rule: me.household.split_rule }}
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex items-center justify-between pt-1">
          {existing ? (
            <Button variant="danger" onClick={() => void remove()} disabled={busy}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!valid || busy}>
              {busy ? 'Saving…' : existing ? 'Save changes' : 'Add expense'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
