import { useState } from 'react'
import type { Category, RecurringTx } from '@fold/shared'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { fmtDate, fmtMoney } from '../format'
import { Button, Chip, ErrorNote, Field, Modal, MoneyInput, Select, TextInput, cls } from '../ui'
import { CategorySelect, PayerPicker } from './TxModal'
import { SplitEditor, computeSplits, inferMode, type SplitMode } from './SplitEditor'

function RecurringForm({
  existing,
  categories,
  onClose,
  onSaved,
}: {
  existing: RecurringTx | null
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}) {
  const { me } = useMe()
  const members = me.household.members
  const [description, setDescription] = useState(existing?.description ?? '')
  const [amount, setAmount] = useState<number | null>(existing?.amount_cents ?? null)
  const [categoryId, setCategoryId] = useState<string | ''>(existing?.category_id ?? '')
  const [payerId, setPayerId] = useState(existing?.payer_user_id ?? me.user.id)
  const [day, setDay] = useState(existing?.day_of_month ?? 1)
  const [cadence, setCadence] = useState<'monthly' | 'yearly'>(existing?.cadence ?? 'monthly')
  const [mode, setMode] = useState<SplitMode>(
    existing ? inferMode(existing.splits, existing.payer_user_id, members) : members.length > 1 ? 'equal' : 'none',
  )
  const [custom, setCustom] = useState<Record<string, number | null>>(() => {
    const initial: Record<string, number | null> = {}
    if (existing) for (const split of existing.splits) initial[split.user_id] = split.share_cents
    return initial
  })
  const [error, setError] = useState<string | null>(null)

  const splits = computeSplits(amount, mode, payerId, members, custom)
  const valid = description.trim() && amount != null && amount > 0 && splits != null

  async function save(): Promise<void> {
    if (!valid) return
    const body = {
      description: description.trim(),
      amount_cents: amount,
      category_id: categoryId || null,
      payer_user_id: payerId,
      splits,
      cadence,
      day_of_month: day,
    }
    try {
      if (existing) await api.patch(`/recurring/${existing.id}`, body)
      else await api.post('/recurring', body)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} autoFocus placeholder="Rent, Spotify…" />
        </Field>
        <Field label="Amount">
          <MoneyInput cents={amount} onCents={setAmount} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Category">
          <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} allowNone />
        </Field>
        <Field label="Repeats">
          <Select value={cadence} onChange={(e) => setCadence(e.target.value as 'monthly' | 'yearly')}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </Select>
        </Field>
        <Field label="On day">
          <Select value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
      </div>
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
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={!valid}>
          {existing ? 'Save changes' : 'Add recurring'}
        </Button>
      </div>
    </div>
  )
}

export default function RecurringModal({
  categories,
  onClose,
  onChanged,
}: {
  categories: Category[]
  onClose: () => void
  onChanged: () => void
}) {
  const { data, reload } = useApi<{ recurring: RecurringTx[] }>('/recurring')
  const [editing, setEditing] = useState<RecurringTx | null>(null)
  const [adding, setAdding] = useState(false)

  async function toggleActive(row: RecurringTx): Promise<void> {
    await api.patch(`/recurring/${row.id}`, { active: row.active === 1 ? 0 : 1 })
    reload()
  }

  async function remove(row: RecurringTx): Promise<void> {
    if (!confirm(`Stop "${row.description}"? Already-posted months stay in the budget.`)) return
    await api.delete(`/recurring/${row.id}`)
    reload()
    onChanged()
  }

  if (adding || editing) {
    return (
      <Modal title={editing ? 'Edit recurring' : 'New recurring transaction'} onClose={() => { setAdding(false); setEditing(null) }}>
        <RecurringForm
          existing={editing}
          categories={categories}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSaved={() => {
            setAdding(false)
            setEditing(null)
            reload()
            onChanged()
          }}
        />
      </Modal>
    )
  }

  return (
    <Modal title="Recurring transactions" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Rent, internet, subscriptions — they post themselves on schedule, split and all, even if the server was off
          that day.
        </p>
        {(data?.recurring ?? []).length === 0 ? (
          <p className="py-3 text-center text-sm text-slate-400">Nothing recurring yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(data?.recurring ?? []).map((row) => (
              <li key={row.id} className="group flex items-center gap-3 py-2.5">
                <button
                  onClick={() => void toggleActive(row)}
                  title={row.active === 1 ? 'Pause' : 'Resume'}
                  className={cls(
                    'h-2.5 w-2.5 shrink-0 rounded-full',
                    row.active === 1 ? 'bg-emerald-500' : 'bg-slate-300',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className={cls('text-sm font-medium', row.active === 0 && 'text-slate-400')}>{row.description}</p>
                  <p className="text-xs text-slate-500">
                    {row.cadence === 'monthly' ? `Every month on the ${row.day_of_month}` : `Yearly`} · next{' '}
                    {fmtDate(row.next_date)}
                  </p>
                </div>
                {row.active === 0 && <Chip>paused</Chip>}
                <span className="text-sm font-semibold tabular-nums">{fmtMoney(row.amount_cents)}</span>
                <button onClick={() => setEditing(row)} className="hidden rounded p-1 text-slate-400 hover:bg-slate-100 group-hover:block">
                  <Pencil size={13} />
                </button>
                <button onClick={() => void remove(row)} className="hidden rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 group-hover:block">
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus size={14} /> Add recurring
        </Button>
      </div>
    </Modal>
  )
}
