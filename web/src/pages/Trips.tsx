import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Trip, TripListItem, TripStatus } from '@fold/shared'
import { MapPin, Plus } from 'lucide-react'
import { api, useApi } from '../api'
import { fmtMoney, fmtRange } from '../format'
import { Button, Card, Chip, EmptyState, ErrorNote, Field, Modal, MoneyInput, ProgressBar, Select, TextInput, cls } from '../ui'

export const STATUS_LABELS: Record<TripStatus, string> = {
  idea: 'Wishlist',
  planned: 'Planned',
  active: 'Happening now',
  done: 'Done',
}

export function TripModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: Trip | null
  onClose: () => void
  onSaved: (id?: string) => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? '')
  const [location, setLocation] = useState(existing?.location ?? '')
  const [status, setStatus] = useState<TripStatus>(existing?.status ?? 'planned')
  const [startDate, setStartDate] = useState(existing?.start_date ?? '')
  const [endDate, setEndDate] = useState(existing?.end_date ?? '')
  const [budget, setBudget] = useState<number | null>(existing?.total_budget_cents ?? null)
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(): Promise<void> {
    setBusy(true)
    const body = {
      name: name.trim(),
      emoji: emoji || null,
      status,
      location: location || null,
      start_date: startDate || null,
      end_date: endDate || null,
      total_budget_cents: budget,
      notes: notes || null,
    }
    try {
      if (existing) {
        await api.patch(`/trips/${existing.id}`, body)
        onSaved()
      } else {
        const result = await api.post<{ id: string }>('/trips', body)
        onSaved(result.id)
      }
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title={existing ? 'Edit trip' : 'Plan a trip'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <Field label="Trip name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Pacific Coast Highway" />
          </Field>
          <Field label="Emoji">
            <TextInput value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🌊" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Where">
            <TextInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="California" />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as TripStatus)}>
              <option value="idea">Wishlist idea</option>
              <option value="planned">Planned</option>
              <option value="active">Happening now</option>
              <option value="done">Done</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End">
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Overall budget" hint="Leave blank to budget by category instead (lodging, food, …).">
          <MoneyInput cents={budget} onCents={setBudget} />
        </Field>
        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
            placeholder="Anniversary road trip…"
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!name.trim() || busy}>
            {existing ? 'Save changes' : 'Create trip'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function TripCard({ trip }: { trip: TripListItem }) {
  const remaining = trip.budget_cents - trip.spent_cents
  return (
    <Link to={`/trips/${trip.id}`} className="block">
      <Card className="h-full transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">
              {trip.emoji} {trip.name}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
              <MapPin size={12} className="shrink-0" />
              <span className="truncate">{trip.location ?? 'Somewhere good'}</span>
            </p>
          </div>
          <Chip
            className={cls(
              trip.status === 'active' && 'bg-emerald-100 text-emerald-700',
              trip.status === 'planned' && 'bg-violet-100 text-violet-700',
            )}
          >
            {STATUS_LABELS[trip.status]}
          </Chip>
        </div>
        <p className="mt-2 text-xs text-slate-500">{fmtRange(trip.start_date, trip.end_date)}</p>
        {trip.budget_cents > 0 && (
          <>
            <ProgressBar value={trip.spent_cents} max={trip.budget_cents} className="mt-3" />
            <p className={cls('mt-1.5 text-xs tabular-nums', remaining < 0 ? 'font-medium text-red-600' : 'text-slate-500')}>
              {fmtMoney(trip.spent_cents)} of {fmtMoney(trip.budget_cents)}
              {remaining >= 0 ? ` · ${fmtMoney(remaining)} left` : ` · ${fmtMoney(-remaining)} over`}
            </p>
          </>
        )}
      </Card>
    </Link>
  )
}

export default function Trips() {
  const { data, reload } = useApi<{ trips: TripListItem[] }>('/trips')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const trips = data?.trips ?? []
  const upcoming = trips.filter((t) => t.status === 'planned' || t.status === 'active')
  const ideas = trips.filter((t) => t.status === 'idea')
  const past = trips.filter((t) => t.status === 'done')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Trips</h1>
          <p className="text-sm text-slate-500">Plan the route, set the budget, watch it hold up.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={15} /> New trip
        </Button>
      </div>

      {trips.length === 0 && data && (
        <EmptyState emoji="🗺️" title="No trips yet">
          Start with a wishlist idea or plan the whole route — stops, lodging, budget and all.
        </EmptyState>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Up next</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {upcoming.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </section>
      )}

      {ideas.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Wishlist</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ideas.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">The books</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {past.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </section>
      )}

      {creating && (
        <TripModal
          existing={null}
          onClose={() => setCreating(false)}
          onSaved={(tripId) => {
            setCreating(false)
            if (tripId) navigate(`/trips/${tripId}`)
            else reload()
          }}
        />
      )}
    </div>
  )
}
