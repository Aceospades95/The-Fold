import { useState } from 'react'
import type { Category, Tx } from '@fold/shared'
import { api } from '../api'
import { useMe } from '../App'
import { todayStr } from '../format'
import { Avatar, Button, ErrorNote, Field, Modal, MoneyInput, Select, TextInput, cls } from '../ui'
import { SplitEditor, computeSplits, inferMode, type SplitMode } from './SplitEditor'

export function CategorySelect({
  categories,
  value,
  onChange,
  allowNone,
}: {
  categories: Category[]
  value: string | ''
  onChange: (id: string | '') => void
  allowNone?: boolean
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
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
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
  const [categoryId, setCategoryId] = useState<string | ''>(existing?.category_id ?? categories.find((c) => c.scope === 'shared')?.id ?? '')
  const [payerId, setPayerId] = useState(existing?.payer_user_id ?? me.user.id)
  const [mode, setMode] = useState<SplitMode>(
    existing ? inferMode(existing.splits, existing.payer_user_id, members) : members.length > 1 ? 'equal' : 'none',
  )
  const [custom, setCustom] = useState<Record<string, number | null>>(() => {
    const initial: Record<string, number | null> = {}
    if (existing) {
      for (const split of existing.splits) initial[split.user_id] = split.share_cents
    }
    return initial
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const splits = computeSplits(amount, mode, payerId, members, custom)
  const valid = description.trim().length > 0 && amount != null && amount > 0 && splits != null

  async function save(): Promise<void> {
    if (!valid) return
    setBusy(true)
    setError(null)
    const body = {
      date,
      description: description.trim(),
      amount_cents: amount,
      category_id: categoryId || null,
      payer_user_id: payerId,
      splits,
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
            <MoneyInput cents={amount} onCents={setAmount} autoFocus={!existing} />
          </Field>
          <Field label="Date">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Groceries, rent, date night…" />
        </Field>
        <Field label="Category">
          <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} allowNone />
        </Field>
        <Field label="Paid by">
          <PayerPicker value={payerId} onChange={setPayerId} />
        </Field>
        <Field label="Split">
          <SplitEditor
            amountCents={amount}
            payerId={payerId}
            members={members}
            mode={mode}
            custom={custom}
            onMode={setMode}
            onCustom={(userId, cents) => setCustom((prev) => ({ ...prev, [userId]: cents }))}
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
