import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Category, TripDetailResponse, TripExpense, TripStop } from '@fold/shared'
import { ArrowDown, ArrowLeft, ArrowUp, BedDouble, CheckCircle2, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { centsToInput, fmtMoney, fmtRange, parseMoney, todayStr } from '../format'
import { Avatar, Button, Card, CardTitle, Chip, ErrorNote, Field, Modal, MoneyInput, ProgressBar, Select, TextInput, cls, inputCls } from '../ui'
import { CategorySelect, PayerPicker } from '../components/TxModal'
import { SplitEditor, computeSplits, type SplitMode } from '../components/SplitEditor'
import { STATUS_LABELS, TripModal } from './Trips'

function StopModal({
  tripId,
  existing,
  onClose,
  onSaved,
}: {
  tripId: string
  existing: TripStop | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [location, setLocation] = useState(existing?.location ?? '')
  const [arrive, setArrive] = useState(existing?.arrive_date ?? '')
  const [depart, setDepart] = useState(existing?.depart_date ?? '')
  const [lodging, setLodging] = useState(existing?.lodging ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    const body = {
      name: name.trim(),
      location: location || null,
      arrive_date: arrive || null,
      depart_date: depart || null,
      lodging: lodging || null,
      notes: notes || null,
    }
    try {
      if (existing) await api.patch(`/trip-stops/${existing.id}`, body)
      else await api.post(`/trips/${tripId}/stops`, body)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title={existing ? 'Edit stop' : 'Add a stop'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stop name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Big Sur" />
          </Field>
          <Field label="Location">
            <TextInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Big Sur, CA" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Arrive">
            <TextInput type="date" value={arrive} onChange={(e) => setArrive(e.target.value)} />
          </Field>
          <Field label="Depart">
            <TextInput type="date" value={depart} onChange={(e) => setDepart(e.target.value)} />
          </Field>
        </div>
        <Field label="Where you’re staying">
          <TextInput value={lodging} onChange={(e) => setLodging(e.target.value)} placeholder="Glen Oaks cabins" />
        </Field>
        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
            placeholder="Sunset at Pfeiffer Beach, dinner reservation at 7…"
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!name.trim()}>{existing ? 'Save' : 'Add stop'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function ExpenseModal({
  trip,
  existing,
  onClose,
  onSaved,
}: {
  trip: TripDetailResponse
  existing: TripExpense | null
  onClose: () => void
  onSaved: () => void
}) {
  const { me } = useMe()
  const [name, setName] = useState(existing?.name ?? '')
  const [categoryId, setCategoryId] = useState(existing?.trip_category_id ?? trip.categories[0]?.id ?? '')
  const [stopId, setStopId] = useState(existing?.stop_id ?? '')
  const [planned, setPlanned] = useState<number | null>(existing?.planned_cents ?? null)
  const [actual, setActual] = useState<number | null>(existing?.actual_cents ?? null)
  const [date, setDate] = useState(existing?.date ?? '')
  const [payerId, setPayerId] = useState(existing?.payer_user_id ?? '')
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    const body = {
      name: name.trim(),
      trip_category_id: categoryId || null,
      stop_id: stopId || null,
      planned_cents: planned ?? 0,
      actual_cents: actual,
      date: date || null,
      payer_user_id: payerId || null,
    }
    try {
      if (existing) await api.patch(`/trip-expenses/${existing.id}`, body)
      else await api.post(`/trips/${trip.trip.id}/expenses`, body)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function remove(): Promise<void> {
    if (!existing) return
    try {
      await api.delete(`/trip-expenses/${existing.id}`)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title={existing ? 'Edit trip expense' : 'Add trip expense'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="What is it?">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Glen Oaks cabin (2 nights)" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorized</option>
              {trip.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Stop">
            <Select value={stopId} onChange={(e) => setStopId(e.target.value)}>
              <option value="">Whole trip</option>
              {trip.stops.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Planned (estimate)">
            <MoneyInput cents={planned} onCents={setPlanned} />
          </Field>
          <Field label="Actually spent" hint="Fill in once it’s paid.">
            <MoneyInput cents={actual} onCents={setActual} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Paid by">
            <Select value={payerId} onChange={(e) => setPayerId(e.target.value)}>
              <option value="">—</option>
              {me.household.members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <ErrorNote message={error} />
        <div className="flex items-center justify-between">
          {existing ? (
            <Button variant="danger" onClick={() => void remove()}>Delete</Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save()} disabled={!name.trim()}>{existing ? 'Save' : 'Add expense'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function PostModal({
  expense,
  onClose,
  onSaved,
}: {
  expense: TripExpense
  onClose: () => void
  onSaved: () => void
}) {
  const { me } = useMe()
  const members = me.household.members
  const categoriesQuery = useApi<{ categories: Category[] }>('/categories')
  const categories = categoriesQuery.data?.categories ?? []
  const [categoryId, setCategoryId] = useState('')
  const [payerId, setPayerId] = useState(expense.payer_user_id ?? me.user.id)
  const [mode, setMode] = useState<SplitMode>(members.length > 1 ? 'equal' : 'none')
  const [custom, setCustom] = useState<Record<string, number | null>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!categoryId && categories.length > 0) {
      const travel = categories.find((c) => c.scope === 'shared' && /travel/i.test(c.name))
      setCategoryId(travel?.id ?? categories.find((c) => c.scope === 'shared')?.id ?? categories[0].id)
    }
  }, [categories, categoryId])

  const amount = expense.actual_cents ?? 0
  const splits = computeSplits(amount, mode, payerId, members, custom)

  async function post(): Promise<void> {
    if (!splits || !categoryId) return
    try {
      await api.post(`/trip-expenses/${expense.id}/post`, { category_id: categoryId, payer_user_id: payerId, splits })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title="Add to the monthly budget" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Posts <strong>{expense.name}</strong> ({fmtMoney(amount)}) as a regular expense, so it counts against your
          monthly budget and the split shows up in your running balance.
        </p>
        <Field label="Budget category">
          <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} />
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
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void post()} disabled={!splits || !categoryId}>Post to budget</Button>
        </div>
      </div>
    </Modal>
  )
}

function TripBudgetCell({ categoryId, budgetCents, onSaved }: { categoryId: string; budgetCents: number; onSaved: () => void }) {
  const [text, setText] = useState(centsToInput(budgetCents))
  useEffect(() => setText(centsToInput(budgetCents)), [budgetCents])
  async function save(): Promise<void> {
    const cents = parseMoney(text || '0')
    if (cents == null || cents === budgetCents) {
      setText(centsToInput(budgetCents))
      return
    }
    await api.patch(`/trip-categories/${categoryId}`, { budget_cents: cents })
    onSaved()
  }
  return (
    <div className="relative w-24">
      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-slate-400">$</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        inputMode="decimal"
        className={cls(inputCls, 'py-1 pl-5 text-right text-sm')}
      />
    </div>
  )
}

export default function TripDetail() {
  const { id: tripId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { me } = useMe()
  const { data, reload, error } = useApi<TripDetailResponse>(tripId ? `/trips/${tripId}` : null)
  const [editingTrip, setEditingTrip] = useState(false)
  const [stopModal, setStopModal] = useState<{ open: boolean; stop: TripStop | null }>({ open: false, stop: null })
  const [expenseModal, setExpenseModal] = useState<{ open: boolean; expense: TripExpense | null }>({ open: false, expense: null })
  const [posting, setPosting] = useState<TripExpense | null>(null)
  const [newCategory, setNewCategory] = useState('')

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600">{error}</p>
        <Link to="/trips" className="text-sm text-violet-600 hover:underline">← Back to trips</Link>
      </div>
    )
  }
  if (!data) return null

  const { trip, totals } = data
  const remaining = totals.budget_cents - totals.spent_cents
  const uncategorized = data.expenses.filter((e) => !e.trip_category_id)
  const uncategorizedPlanned = uncategorized.reduce((sum, e) => sum + e.planned_cents, 0)
  const uncategorizedSpent = uncategorized.reduce((sum, e) => sum + (e.actual_cents ?? 0), 0)

  async function removeTrip(): Promise<void> {
    if (!confirm(`Delete "${trip.name}" and everything in it?`)) return
    await api.delete(`/trips/${trip.id}`)
    navigate('/trips')
  }

  async function moveStop(index: number, delta: number): Promise<void> {
    const ids = data!.stops.map((s) => s.id)
    const target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    await api.post(`/trips/${trip.id}/stops/reorder`, { ids })
    reload()
  }

  async function deleteStop(stop: TripStop): Promise<void> {
    if (!confirm(`Remove the "${stop.name}" stop?`)) return
    await api.delete(`/trip-stops/${stop.id}`)
    reload()
  }

  async function addCategory(): Promise<void> {
    if (!newCategory.trim()) return
    await api.post(`/trips/${trip.id}/categories`, { name: newCategory.trim(), budget_cents: 0 })
    setNewCategory('')
    reload()
  }

  async function deleteCategory(categoryId: string, name: string): Promise<void> {
    if (!confirm(`Remove the "${name}" bucket? Its expenses become uncategorized.`)) return
    await api.delete(`/trip-categories/${categoryId}`)
    reload()
  }

  return (
    <div className="space-y-5">
      <div>
        <Link to="/trips" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> All trips
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">
              {trip.name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1"><MapPin size={13} /> {trip.location ?? 'Somewhere good'}</span>
              <span>{fmtRange(trip.start_date, trip.end_date)}</span>
              <Chip className={cls(trip.status === 'planned' && 'bg-violet-100 text-violet-700', trip.status === 'active' && 'bg-emerald-100 text-emerald-700')}>
                {STATUS_LABELS[trip.status]}
              </Chip>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditingTrip(true)}>
              <Pencil size={14} /> Edit
            </Button>
            <Button variant="danger" onClick={() => void removeTrip()}>
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
        {trip.notes && <p className="mt-2 max-w-2xl text-sm text-slate-600">{trip.notes}</p>}
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Budget</p>
            <p className="text-xl font-bold tabular-nums">{fmtMoney(totals.budget_cents)}</p>
            <p className="text-[11px] text-slate-400">{totals.budget_source === 'total' ? 'set for the whole trip' : 'sum of the buckets below'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Planned</p>
            <p className="text-xl font-bold tabular-nums">{fmtMoney(totals.planned_cents)}</p>
            <p className="text-[11px] text-slate-400">estimates so far</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Spent</p>
            <p className="text-xl font-bold tabular-nums">{fmtMoney(totals.spent_cents)}</p>
            <p className="text-[11px] text-slate-400">actually paid</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{remaining >= 0 ? 'Remaining' : 'Over budget'}</p>
            <p className={cls('text-xl font-bold tabular-nums', remaining >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {fmtMoney(Math.abs(remaining))}
            </p>
          </div>
        </div>
        <ProgressBar value={totals.spent_cents} max={totals.budget_cents} className="mt-4" />
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardTitle
            action={
              <Button variant="secondary" onClick={() => setStopModal({ open: true, stop: null })}>
                <Plus size={14} /> Stop
              </Button>
            }
          >
            Itinerary
          </CardTitle>
          {data.stops.length === 0 ? (
            <p className="text-sm text-slate-500">No stops yet — add the route one stop at a time.</p>
          ) : (
            <ol className="space-y-0.5">
              {data.stops.map((stop, index) => (
                <li key={stop.id} className="group relative flex gap-3 rounded-xl px-2 py-2.5 hover:bg-slate-50">
                  <div className="flex flex-col items-center">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                      {index + 1}
                    </span>
                    {index < data.stops.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{stop.name}</p>
                      <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                        <button onClick={() => void moveStop(index, -1)} className="rounded p-1 text-slate-400 hover:bg-slate-200"><ArrowUp size={13} /></button>
                        <button onClick={() => void moveStop(index, 1)} className="rounded p-1 text-slate-400 hover:bg-slate-200"><ArrowDown size={13} /></button>
                        <button onClick={() => setStopModal({ open: true, stop })} className="rounded p-1 text-slate-400 hover:bg-slate-200"><Pencil size={13} /></button>
                        <button onClick={() => void deleteStop(stop)} className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-600"><Trash2 size={13} /></button>
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {fmtRange(stop.arrive_date, stop.depart_date)}
                      {stop.location ? ` · ${stop.location}` : ''}
                    </p>
                    {stop.lodging && (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-600">
                        <BedDouble size={12} className="text-slate-400" /> {stop.lodging}
                      </p>
                    )}
                    {stop.notes && <p className="mt-0.5 text-xs text-slate-500">{stop.notes}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card>
          <CardTitle>Budget buckets</CardTitle>
          <div className="divide-y divide-slate-100">
            {data.categories.map((cat) => {
              const catRemaining = cat.budget_cents - cat.spent_cents
              return (
                <div key={cat.id} className="group py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      {cat.name}
                      <button
                        onClick={() => void deleteCategory(cat.id, cat.name)}
                        className="hidden rounded p-0.5 text-slate-300 hover:text-red-500 group-hover:inline"
                      >
                        <Trash2 size={12} />
                      </button>
                    </p>
                    <TripBudgetCell categoryId={cat.id} budgetCents={cat.budget_cents} onSaved={reload} />
                  </div>
                  <ProgressBar value={cat.spent_cents} max={cat.budget_cents} className="mt-1.5" />
                  <p className={cls('mt-1 text-xs tabular-nums', catRemaining < 0 ? 'font-medium text-red-600' : 'text-slate-500')}>
                    {fmtMoney(cat.spent_cents)} spent · {fmtMoney(cat.planned_cents)} planned ·{' '}
                    {catRemaining >= 0 ? `${fmtMoney(catRemaining)} left` : `${fmtMoney(-catRemaining)} over`}
                  </p>
                </div>
              )
            })}
            {uncategorized.length > 0 && (
              <div className="py-2.5">
                <p className="text-sm font-medium text-slate-500">Uncategorized</p>
                <p className="mt-1 text-xs tabular-nums text-slate-500">
                  {fmtMoney(uncategorizedSpent)} spent · {fmtMoney(uncategorizedPlanned)} planned
                </p>
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <TextInput
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addCategory()}
              placeholder="New bucket (e.g. Souvenirs)"
              className="flex-1"
            />
            <Button variant="secondary" onClick={() => void addCategory()} disabled={!newCategory.trim()}>
              Add
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle
          action={
            <Button variant="secondary" onClick={() => setExpenseModal({ open: true, expense: null })}>
              <Plus size={14} /> Expense
            </Button>
          }
        >
          Expenses
        </CardTitle>
        {data.expenses.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing yet. Add planned costs now (lodging, gas, activities) and fill in actuals as you pay them.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-3">Expense</th>
                  <th className="pb-2 pr-3">Bucket</th>
                  <th className="pb-2 pr-3 text-right">Planned</th>
                  <th className="pb-2 pr-3 text-right">Actual</th>
                  <th className="pb-2 pr-3">Paid by</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.expenses.map((expense) => {
                  const category = data.categories.find((c) => c.id === expense.trip_category_id)
                  const stop = data.stops.find((s) => s.id === expense.stop_id)
                  const payer = me.household.members.find((m) => m.id === expense.payer_user_id)
                  return (
                    <tr key={expense.id} className="group">
                      <td className="py-2.5 pr-3">
                        <button onClick={() => setExpenseModal({ open: true, expense })} className="text-left font-medium hover:text-violet-700">
                          {expense.name}
                        </button>
                        {stop && <p className="text-xs text-slate-400">@ {stop.name}</p>}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-500">{category?.name ?? '—'}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-slate-500">{fmtMoney(expense.planned_cents)}</td>
                      <td className="py-2.5 pr-3 text-right font-medium tabular-nums">
                        {expense.actual_cents != null ? fmtMoney(expense.actual_cents) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="py-2.5 pr-3">{payer ? <Avatar name={payer.name} color={payer.color} size={22} /> : <span className="text-slate-300">—</span>}</td>
                      <td className="py-2.5 text-right">
                        {expense.posted_transaction_id ? (
                          <Chip className="bg-emerald-100 text-emerald-700">
                            <CheckCircle2 size={11} /> in budget
                          </Chip>
                        ) : expense.actual_cents != null && expense.actual_cents > 0 ? (
                          <Button variant="ghost" onClick={() => setPosting(expense)} className="!px-2 !py-1 text-xs text-violet-600">
                            Post to budget
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editingTrip && (
        <TripModal
          existing={trip}
          onClose={() => setEditingTrip(false)}
          onSaved={() => {
            setEditingTrip(false)
            reload()
          }}
        />
      )}
      {stopModal.open && (
        <StopModal
          tripId={trip.id}
          existing={stopModal.stop}
          onClose={() => setStopModal({ open: false, stop: null })}
          onSaved={() => {
            setStopModal({ open: false, stop: null })
            reload()
          }}
        />
      )}
      {expenseModal.open && (
        <ExpenseModal
          trip={data}
          existing={expenseModal.expense}
          onClose={() => setExpenseModal({ open: false, expense: null })}
          onSaved={() => {
            setExpenseModal({ open: false, expense: null })
            reload()
          }}
        />
      )}
      {posting && (
        <PostModal
          expense={posting}
          onClose={() => setPosting(null)}
          onSaved={() => {
            setPosting(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
