import { useRef, useState } from 'react'
import type { Category, Merchant, Tx } from '@fold/shared'
import { Plus, Split as SplitIcon, X } from 'lucide-react'
import { api } from '../api'
import { useMe } from '../App'
import { fmtDate, fmtMoney, todayStr } from '../format'
import { Avatar, Button, ErrorNote, Field, Modal, MoneyInput, Select, TextInput, cls } from '../ui'
import { MerchantLogo } from './merchants'
import { SplitEditor, computeSplits, inferMode, type SplitLine, type SplitMode } from './SplitEditor'

/**
 * Description input doubling as a store search: pick a known store (logo +
 * its usual category) or create one from what you typed.
 */
function StorePicker({
  description,
  merchantId,
  merchants,
  categories,
  onDescription,
  onPick,
  onCreate,
}: {
  description: string
  merchantId: string | null
  merchants: Merchant[]
  categories: Category[]
  onDescription: (text: string) => void
  onPick: (merchant: Merchant | null) => void
  onCreate: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const selected = merchants.find((m) => m.id === merchantId) ?? null
  const query = description.trim().toLowerCase()
  const suggestions = query
    ? merchants.filter((m) => m.name.toLowerCase().includes(query)).slice(0, 6)
    : merchants.slice(0, 6)
  const exact = merchants.some((m) => m.name.toLowerCase() === query)

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5">
        <MerchantLogo name={selected.name} domain={selected.domain} size={26} />
        <span className="flex-1 truncate text-sm font-medium">{selected.name}</span>
        <button
          type="button"
          title="Unlink store"
          onClick={() => onPick(null)}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <TextInput
        value={description}
        onChange={(e) => {
          onDescription(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150)
        }}
        placeholder="Costco, rent, date night…"
      />
      {open && (suggestions.length > 0 || query.length > 1) && (
        <div
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          onMouseDown={() => clearTimeout(blurTimer.current)}
        >
          {suggestions.map((merchant) => {
            const topCategory = categories.find((c) => c.id === merchant.top_category_id)
            return (
              <button
                key={merchant.id}
                type="button"
                onClick={() => {
                  onPick(merchant)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-slate-50"
              >
                <MerchantLogo name={merchant.name} domain={merchant.domain} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{merchant.name}</span>
                {topCategory && (
                  <span className="shrink-0 text-xs text-slate-400">
                    usually {topCategory.emoji} {topCategory.name}
                  </span>
                )}
              </button>
            )
          })}
          {query.length > 1 && !exact && (
            <button
              type="button"
              onClick={() => {
                onCreate(description.trim())
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-medium text-violet-700 hover:bg-violet-50"
            >
              <Plus size={14} /> Add “{description.trim()}” as a store
            </button>
          )}
        </div>
      )}
    </div>
  )
}

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
  merchants = [],
  onMerchantsChanged,
  onClose,
  onSaved,
}: {
  existing: Tx | null
  categories: Category[]
  merchants?: Merchant[]
  onMerchantsChanged?: () => void
  onClose: () => void
  onSaved: () => void
}) {
  const { me } = useMe()
  const members = me.household.members
  const [merchantId, setMerchantId] = useState<string | null>(existing?.merchant_id ?? null)
  // Work in absolute values; `refund` flips the sign on save.
  const [refund, setRefund] = useState((existing?.amount_cents ?? 0) < 0)
  const [description, setDescription] = useState(existing?.description ?? '')
  const [amount, setAmount] = useState<number | null>(existing ? Math.abs(existing.amount_cents) : null)
  const [date, setDate] = useState(existing?.date ?? todayStr())
  const [payerId, setPayerId] = useState(existing?.payer_user_id ?? me.user.id)
  const [lines, setLines] = useState<SplitLine[]>(() => {
    if (existing && existing.lines.length > 0) {
      return existing.lines.map((line) => ({ category_id: line.category_id ?? '', amount_cents: Math.abs(line.amount_cents) }))
    }
    return [{ category_id: categories.find((c) => c.scope === 'shared')?.id ?? '', amount_cents: existing ? Math.abs(existing.amount_cents) : null }]
  })
  const [mode, setMode] = useState<SplitMode>(() => {
    if (!existing) return members.length > 1 ? 'equal' : 'none'
    const absSplits = existing.splits.map((s) => ({ ...s, share_cents: Math.abs(s.share_cents) }))
    return inferMode(absSplits, existing.payer_user_id, members, {
      lines: existing.lines.map((line) => ({ category_id: line.category_id ?? '', amount_cents: Math.abs(line.amount_cents) })),
      categories,
      rule: me.household.split_rule,
    })
  })
  const [custom, setCustom] = useState<Record<string, number | null>>(() => {
    const initial: Record<string, number | null> = {}
    if (existing) for (const split of existing.splits) initial[split.user_id] = Math.abs(split.share_cents)
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
    const sign = refund ? -1 : 1

    // Catch double entry before it happens: same amount within a few days.
    if (!existing && !refund) {
      try {
        const check = await api.post<{ matches: ({ description: string; date: string; imported: boolean } | null)[] }>(
          '/transactions/check-duplicates',
          { rows: [{ date, amount_cents: amount! }] },
        )
        const match = check.matches[0]
        if (match) {
          const source = match.imported ? 'imported' : 'entered'
          const proceed = confirm(
            `Heads up — "${match.description}" (${source} on ${fmtDate(match.date)}) has the same amount. Add this anyway?`,
          )
          if (!proceed) {
            setBusy(false)
            return
          }
        }
      } catch {
        // The duplicate check is advisory; never block saving on it.
      }
    }

    const body = {
      date,
      description: description.trim(),
      amount_cents: amount! * sign,
      category_id: multiLine ? null : lines[0]?.category_id || null,
      payer_user_id: payerId,
      merchant_id: merchantId,
      splits: splits!.map((s) => ({ ...s, share_cents: s.share_cents * sign })),
      lines: multiLine
        ? lines.map((line) => ({ category_id: line.category_id || null, amount_cents: line.amount_cents! * sign }))
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
        <Field label="Store / description">
          <StorePicker
            description={description}
            merchantId={merchantId}
            merchants={merchants}
            categories={categories}
            onDescription={setDescription}
            onPick={(merchant) => {
              setMerchantId(merchant?.id ?? null)
              if (merchant) {
                setDescription(merchant.name)
                // Adopt the store's usual category when nothing meaningful is set yet.
                if (!multiLine && merchant.top_category_id) {
                  setLines([{ category_id: merchant.top_category_id, amount_cents: amount }])
                }
              }
            }}
            onCreate={(name) => {
              void api
                .post<{ id: string }>('/merchants', { name })
                .then((result) => {
                  setMerchantId(result.id)
                  setDescription(name)
                  onMerchantsChanged?.()
                })
                .catch((err: Error) => setError(err.message))
            }}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={refund}
            onChange={(e) => setRefund(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-violet-600"
          />
          This is a refund / credit — money coming back
        </label>
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
