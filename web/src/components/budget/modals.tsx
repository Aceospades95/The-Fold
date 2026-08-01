import { useState } from 'react'
import type { BudgetCategoryRow, BudgetResponse, CategoryGroup, SpendBucket } from '@fold/shared'
import { BUCKET_LABELS } from '@fold/shared'
import { api } from '../../api'
import { useMe } from '../../App'
import { fmtMoney } from '../../format'
import { Button, ErrorNote, Field, Modal, MoneyInput, Select, TextInput } from '../../ui'

export function MoveMoneyModal({
  budget,
  month,
  target,
  onClose,
  onSaved,
}: {
  budget: BudgetResponse
  month: string
  target: BudgetCategoryRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const shortfall = target && target.available_cents < 0 ? -target.available_cents : null
  const [toId, setToId] = useState(target?.id ?? budget.categories[0]?.id ?? '')
  const [fromId, setFromId] = useState('')
  const [amount, setAmount] = useState<number | null>(shortfall)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const donors = budget.categories.filter((c) => c.id !== toId && c.allocated_cents > 0)

  async function save(): Promise<void> {
    if (!amount || !toId) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/budget/${month}/move`, {
        from_category_id: fromId || null,
        to_category_id: toId,
        amount_cents: amount,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Move money" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {shortfall
            ? `${target!.name} is over by ${fmtMoney(shortfall)}. Pull it from an envelope with room to spare.`
            : 'Shift budgeted money between envelopes without changing what you actually spent.'}
        </p>
        <Field label="From">
          <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">Unassigned income (add new money)</option>
            {donors.map((category) => (
              <option key={category.id} value={category.id}>
                {category.emoji} {category.name} — {fmtMoney(category.available_cents)} available
              </option>
            ))}
          </Select>
        </Field>
        <Field label="To">
          <Select value={toId} onChange={(e) => setToId(e.target.value)}>
            {budget.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.emoji} {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount">
          <MoneyInput cents={amount} onCents={setAmount} autoFocus />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!amount || busy}>
            Move {amount ? fmtMoney(amount) : 'money'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function NewCategoryModal({
  groups,
  defaultScope,
  defaultOwner,
  defaultGroupId,
  onClose,
  onSaved,
}: {
  groups: CategoryGroup[]
  defaultScope: 'shared' | 'personal'
  defaultOwner?: string
  defaultGroupId?: string
  onClose: () => void
  onSaved: () => void
}) {
  const { me } = useMe()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [scope, setScope] = useState<'shared' | 'personal'>(defaultScope)
  const [owner, setOwner] = useState(defaultOwner ?? me.user.id)
  const [groupId, setGroupId] = useState(defaultGroupId ?? '')
  const [rollover, setRollover] = useState(false)
  const [bucket, setBucket] = useState<SpendBucket | ''>('')
  const [target, setTarget] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    try {
      await api.post('/categories', {
        name: name.trim(),
        emoji: emoji || null,
        scope,
        owner_user_id: scope === 'personal' ? owner : null,
        group_id: scope === 'shared' ? groupId || null : null,
        rollover: rollover ? 1 : 0,
        bucket: bucket || undefined,
        target_type: target ? 'monthly' : 'none',
        target_cents: target,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title="New category" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Pet stuff, Gifts…" />
          </Field>
          <Field label="Emoji">
            <TextInput value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🐕" />
          </Field>
        </div>
        <Field label="Type">
          <Select value={scope} onChange={(e) => setScope(e.target.value as 'shared' | 'personal')}>
            <option value="shared">Shared — funded by both of you</option>
            <option value="personal">Personal — one person’s own budget</option>
          </Select>
        </Field>
        {scope === 'personal' ? (
          <Field label="Whose budget?">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
              {me.household.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Group">
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">No group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.emoji} {group.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monthly target (optional)" hint="How much you aim to budget here.">
            <MoneyInput cents={target} onCents={setTarget} />
          </Field>
          <Field label="Counts as" hint="For the 50/30/20 & savings views.">
            <Select value={bucket} onChange={(e) => setBucket(e.target.value as SpendBucket | '')}>
              <option value="">{scope === 'personal' ? 'Wants (default)' : 'Needs (default)'}</option>
              {(Object.entries(BUCKET_LABELS) as [SpendBucket, string][]).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
          <input
            type="checkbox"
            checked={rollover}
            onChange={(e) => setRollover(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600"
          />
          <span>
            <span className="block text-sm font-medium">Roll leftover into next month</span>
            <span className="block text-xs text-slate-500">Turn on for envelopes that save up over time.</span>
          </span>
        </label>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!name.trim()}>
            Add category
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function NewGroupModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    try {
      await api.post('/category-groups', { name: name.trim(), emoji: emoji || null })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title="New group" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Groups keep the budget readable — Home, Food, Getting around…</p>
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Kids, Hobbies…" />
          </Field>
          <Field label="Emoji">
            <TextInput value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🎈" />
          </Field>
        </div>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!name.trim()}>
            Add group
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function IncomeOverrideModal({
  month,
  member,
  onClose,
  onSaved,
}: {
  month: string
  member: { id: string; name: string; monthly_income_cents: number; income_override_cents: number | null }
  onClose: () => void
  onSaved: () => void
}) {
  const [amount, setAmount] = useState<number | null>(member.monthly_income_cents)
  const [error, setError] = useState<string | null>(null)

  async function save(value: number | null): Promise<void> {
    try {
      await api.put(`/budget/${month}/income`, { user_id: member.id, amount_cents: value })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title={`${member.name}'s income this month`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Override the usual amount for {month} only — handy for a bonus, a third paycheck, or a slow month. Income
          sources live in Settings.
        </p>
        <Field label="Income for this month">
          <MoneyInput cents={amount} onCents={setAmount} autoFocus />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-between">
          {member.income_override_cents != null ? (
            <Button variant="secondary" onClick={() => void save(null)}>
              Use the usual amount
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save(amount)} disabled={amount == null}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
