import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { BudgetCategoryRow, BudgetResponse } from '@fold/shared'
import { Archive, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { centsToInput, currentMonth, fmtMoney, fmtMonth, parseMoney, shiftMonth } from '../format'
import { Avatar, Button, Card, ErrorNote, Field, Modal, ProgressBar, Select, TextInput, cls, inputCls } from '../ui'

function AllocationCell({ month, row, onSaved }: { month: string; row: BudgetCategoryRow; onSaved: () => void }) {
  const [text, setText] = useState(centsToInput(row.allocated_cents))
  useEffect(() => setText(centsToInput(row.allocated_cents)), [row.allocated_cents, month])

  async function save(): Promise<void> {
    const cents = parseMoney(text || '0')
    if (cents == null || cents === row.allocated_cents) {
      setText(centsToInput(row.allocated_cents))
      return
    }
    await api.put(`/budget/${month}/allocations`, { category_id: row.id, amount_cents: cents })
    onSaved()
  }

  return (
    <div className="relative w-28">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-slate-400">$</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        inputMode="decimal"
        className={cls(inputCls, 'py-1.5 pl-6 text-right text-sm')}
      />
    </div>
  )
}

function CategoryTable({
  month,
  rows,
  accent,
  onChanged,
}: {
  month: string
  rows: BudgetCategoryRow[]
  accent: string
  onChanged: () => void
}) {
  async function archive(row: BudgetCategoryRow): Promise<void> {
    if (!confirm(`Remove "${row.name}" from the budget? Past spending stays on record.`)) return
    await api.delete(`/categories/${row.id}`)
    onChanged()
  }

  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => {
        const remaining = row.allocated_cents - row.spent_cents
        return (
          <div key={row.id} className="group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(140px,1fr)_auto_auto]">
            <div className="flex items-center gap-2 truncate">
              <span className="text-lg">{row.emoji ?? '🏷️'}</span>
              <span className="truncate text-sm font-medium">{row.name}</span>
              <button
                onClick={() => void archive(row)}
                title="Remove category"
                className="hidden rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500 group-hover:inline-flex"
              >
                <Archive size={13} />
              </button>
            </div>
            <div className="col-span-1 hidden sm:block">
              <ProgressBar value={row.spent_cents} max={row.allocated_cents} color={accent} />
              <p className={cls('mt-1 text-xs tabular-nums', remaining < 0 ? 'font-medium text-red-600' : 'text-slate-500')}>
                {fmtMoney(row.spent_cents)} spent · {remaining >= 0 ? `${fmtMoney(remaining)} left` : `${fmtMoney(-remaining)} over`}
              </p>
            </div>
            <AllocationCell month={month} row={row} onSaved={onChanged} />
          </div>
        )
      })}
      {rows.length === 0 && <p className="py-3 text-sm text-slate-500">No categories here yet.</p>}
    </div>
  )
}

function AddCategoryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { me } = useMe()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [scope, setScope] = useState<'shared' | 'personal'>('shared')
  const [owner, setOwner] = useState(me.user.id)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    try {
      await api.post('/categories', {
        name,
        emoji: emoji || null,
        scope,
        owner_user_id: scope === 'personal' ? owner : null,
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
        {scope === 'personal' && (
          <Field label="Whose budget?">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
              {me.household.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
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

export default function Budget() {
  const { me } = useMe()
  const [month, setMonth] = useState(currentMonth())
  const { data, reload } = useApi<BudgetResponse>(`/budget/${month}`)
  const [addingCategory, setAddingCategory] = useState(false)

  if (!data) return null

  const ruleLabel =
    data.split_rule === 'equal' ? 'split 50/50' : data.split_rule === 'proportional' ? 'split by income' : 'custom split'

  async function copyLastMonth(): Promise<void> {
    await api.post(`/budget/${month}/copy`, { from: shiftMonth(month, -1) })
    reload()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Budget</h1>
          <p className="text-sm text-slate-500">
            Shared costs are {ruleLabel} (<Link to="/settings" className="text-violet-600 hover:underline">change</Link>); what’s left is yours to allocate.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <ChevronLeft size={17} />
          </button>
          <span className="w-36 text-center text-sm font-semibold">{fmtMonth(month)}</span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <ChevronRight size={17} />
          </button>
        </div>
      </div>

      {!data.has_allocations && (
        <Card className="flex items-center justify-between bg-violet-50/60">
          <p className="text-sm text-slate-700">This month has no budget yet.</p>
          <Button variant="secondary" onClick={() => void copyLastMonth()}>
            Copy {fmtMonth(shiftMonth(month, -1))}
          </Button>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {data.members.map((member) => (
          <Card key={member.id}>
            <div className="mb-3 flex items-center gap-2.5">
              <Avatar name={member.name} color={member.color} size={32} />
              <div>
                <p className="font-semibold">{member.name}</p>
                <p className="text-xs text-slate-500">{fmtMoney(member.monthly_income_cents)} / month income</p>
              </div>
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Share of joint budget</dt>
                <dd className="font-medium tabular-nums">{fmtMoney(member.contribution_cents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Personal budget</dt>
                <dd className="font-medium tabular-nums">{fmtMoney(member.personal_allocated_cents)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-1.5">
                <dt className="text-slate-500">Left unallocated</dt>
                <dd className={cls('font-semibold tabular-nums', member.left_cents < 0 ? 'text-red-600' : 'text-emerald-600')}>
                  {fmtMoney(member.left_cents)}
                </dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Our shared budget</h2>
            <p className="text-xs text-slate-500">
              {fmtMoney(data.shared_spent_cents)} spent of {fmtMoney(data.shared_allocated_cents)}
            </p>
          </div>
          <Button variant="secondary" onClick={() => setAddingCategory(true)}>
            <Plus size={14} /> Category
          </Button>
        </div>
        <CategoryTable month={month} rows={data.categories.filter((c) => c.scope === 'shared')} accent="#7c3aed" onChanged={reload} />
      </Card>

      {data.members.map((member) => {
        const isMe = member.id === me.user.id
        return (
          <Card key={member.id}>
            <div className="mb-2 flex items-center gap-2.5">
              <Avatar name={member.name} color={member.color} size={26} />
              <h2 className="font-semibold">{isMe ? 'My personal budget' : `${member.name}’s personal budget`}</h2>
            </div>
            <CategoryTable
              month={month}
              rows={data.categories.filter((c) => c.scope === 'personal' && c.owner_user_id === member.id)}
              accent={member.color}
              onChanged={reload}
            />
          </Card>
        )
      })}

      {addingCategory && (
        <AddCategoryModal
          onClose={() => setAddingCategory(false)}
          onSaved={() => {
            setAddingCategory(false)
            reload()
          }}
        />
      )}
    </div>
  )
}
