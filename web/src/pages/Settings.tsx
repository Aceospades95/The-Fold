import { useState } from 'react'
import type { IncomeSource, SplitRule } from '@fold/shared'
import { CADENCES, monthlyCents } from '@fold/shared'
import { Check, Copy, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { fmtMoney } from '../format'
import { Avatar, Button, Card, CardTitle, Chip, ErrorNote, Field, Modal, MoneyInput, Select, TextInput, cls } from '../ui'

function IncomeModal({
  existing,
  defaultUserId,
  onClose,
  onSaved,
}: {
  existing: IncomeSource | null
  defaultUserId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { me } = useMe()
  const [userId, setUserId] = useState(existing?.user_id ?? defaultUserId)
  const [name, setName] = useState(existing?.name ?? '')
  const [amount, setAmount] = useState<number | null>(existing?.amount_cents ?? null)
  const [cadence, setCadence] = useState(existing?.cadence ?? 'biweekly')
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    if (!amount) return
    try {
      if (existing) {
        await api.patch(`/income/${existing.id}`, { name: name.trim(), amount_cents: amount, cadence })
      } else {
        await api.post('/income', { user_id: userId, name: name.trim(), amount_cents: amount, cadence })
      }
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title={existing ? 'Edit income' : 'Add income'} onClose={onClose}>
      <div className="space-y-4">
        {!existing && (
          <Field label="Whose income?">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              {me.household.members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Source">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Salary, side gig…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount per paycheck">
            <MoneyInput cents={amount} onCents={setAmount} />
          </Field>
          <Field label="How often">
            <Select value={cadence} onChange={(e) => setCadence(e.target.value as IncomeSource['cadence'])}>
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        {amount != null && amount > 0 && (
          <p className="text-sm text-slate-600">≈ {fmtMoney(monthlyCents(amount, cadence))} per month</p>
        )}
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!name.trim() || !amount}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}

function AddPartnerCard({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    try {
      await api.post('/household/members', { name, email, password })
      onAdded()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-dashed border-slate-300 p-4">
      <p className="text-sm font-medium text-slate-700">Add your partner</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Temp password" />
      </div>
      <ErrorNote message={error} />
      <Button variant="secondary" onClick={() => void save()} disabled={!name || !email || password.length < 6}>
        <Plus size={14} /> Add partner
      </Button>
    </div>
  )
}

const INTEGRATIONS: { name: string; emoji: string; status: 'live' | 'planned'; blurb: string }[] = [
  { name: 'Google Calendar (feed)', emoji: '📅', status: 'live', blurb: 'Subscribe to the calendar feed below — trips, stops, and due dates show up automatically.' },
  { name: 'Google Calendar & Tasks (two-way)', emoji: '🔁', status: 'planned', blurb: 'OAuth per person: create real events on a shared calendar, sync assigned to-dos to Google Tasks.' },
  { name: 'Email reminders', emoji: '📬', status: 'planned', blurb: 'Digest + nudges from your own Gmail or a dedicated app account via SMTP.' },
  { name: 'Bank sync (SimpleFIN / Plaid)', emoji: '🏦', status: 'planned', blurb: 'Pull real transactions from your banks and match them to budget categories.' },
  { name: 'Investments & net worth', emoji: '📈', status: 'planned', blurb: 'Track accounts and holdings Mint-style, with a household net-worth view.' },
  { name: 'Home Assistant', emoji: '🏡', status: 'planned', blurb: 'Webhooks both ways — start a “date night” scene, log chores from dashboards.' },
  { name: 'Tandoor Recipes', emoji: '🍳', status: 'planned', blurb: 'Pick recipes for the week and push ingredients straight onto the grocery list.' },
  { name: 'Plex + Overseerr date night', emoji: '🎬', status: 'planned', blurb: 'Queue a movie, dim the lights, dinner from Tandoor — one button.' },
  { name: 'Shy Local', emoji: '💞', status: 'planned', blurb: 'Pull date ideas from your activity planner into the trip/date wishlist.' },
]

export default function Settings() {
  const { me, reloadMe } = useMe()
  const income = useApi<{ sources: IncomeSource[] }>('/income')
  const [householdName, setHouseholdName] = useState(me.household.name)
  const [rule, setRule] = useState<SplitRule>(me.household.split_rule)
  const [customSplit, setCustomSplit] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {}
    for (const m of me.household.members) {
      initial[m.id] = me.household.custom_split?.[m.id] ?? Math.round(100 / me.household.members.length)
    }
    return initial
  })
  const [incomeModal, setIncomeModal] = useState<{ open: boolean; source: IncomeSource | null }>({ open: false, source: null })
  const [copied, setCopied] = useState(false)
  const [savedNote, setSavedNote] = useState(false)

  const calendarUrl = `${window.location.origin}${me.household.calendar_path}`
  const customTotal = Object.values(customSplit).reduce((sum, v) => sum + v, 0)

  async function saveHousehold(): Promise<void> {
    await api.patch('/household', {
      name: householdName,
      split_rule: rule,
      custom_split: rule === 'custom' ? customSplit : null,
    })
    await reloadMe()
    setSavedNote(true)
    setTimeout(() => setSavedNote(false), 2000)
  }

  async function deleteIncome(source: IncomeSource): Promise<void> {
    if (!confirm(`Remove "${source.name}"?`)) return
    await api.delete(`/income/${source.id}`)
    income.reload()
    await reloadMe()
  }

  async function copyUrl(): Promise<void> {
    await navigator.clipboard.writeText(calendarUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function rotateToken(): Promise<void> {
    if (!confirm('Get a new calendar link? The old one stops working everywhere it was added.')) return
    await api.post('/household/calendar-token/rotate')
    await reloadMe()
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-slate-500">Your household, your money rules, your integrations.</p>
      </div>

      <Card>
        <CardTitle>Household</CardTitle>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Name">
            <TextInput value={householdName} onChange={(e) => setHouseholdName(e.target.value)} className="w-56" />
          </Field>
          <Button variant="secondary" onClick={() => void saveHousehold()}>
            {savedNote ? <Check size={14} /> : null} Save
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {me.household.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <Avatar name={m.name} color={m.color} />
              <div>
                <p className="text-sm font-medium">
                  {m.name} {m.id === me.user.id && <span className="text-xs text-slate-400">(you)</span>}
                </p>
                <p className="text-xs text-slate-500">{m.email}</p>
              </div>
            </div>
          ))}
        </div>
        {me.household.members.length < 2 && <AddPartnerCard onAdded={() => void reloadMe()} />}
      </Card>

      <Card>
        <CardTitle
          action={
            <Button variant="secondary" onClick={() => setIncomeModal({ open: true, source: null })}>
              <Plus size={14} /> Income
            </Button>
          }
        >
          Income
        </CardTitle>
        <p className="mb-3 text-sm text-slate-500">
          Each person’s take-home pay. This drives the “split by income” rule and how much is free to allocate.
        </p>
        <div className="space-y-4">
          {me.household.members.map((member) => {
            const sources = (income.data?.sources ?? []).filter((s) => s.user_id === member.id)
            return (
              <div key={member.id}>
                <div className="mb-1.5 flex items-center gap-2">
                  <Avatar name={member.name} color={member.color} size={22} />
                  <span className="text-sm font-semibold">{member.name}</span>
                  <span className="text-xs text-slate-500">{fmtMoney(member.monthly_income_cents)} / mo</span>
                </div>
                {sources.length === 0 ? (
                  <p className="ml-8 text-sm text-slate-400">No income added yet.</p>
                ) : (
                  <ul className="ml-8 divide-y divide-slate-100">
                    {sources.map((source) => (
                      <li key={source.id} className="group flex items-center gap-2 py-1.5 text-sm">
                        <span className="flex-1">{source.name}</span>
                        <span className="tabular-nums text-slate-500">
                          {fmtMoney(source.amount_cents)} {CADENCES.find((c) => c.value === source.cadence)?.label.toLowerCase()}
                        </span>
                        <button
                          onClick={() => setIncomeModal({ open: true, source })}
                          className="hidden rounded p-1 text-slate-400 hover:bg-slate-100 group-hover:block"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => void deleteIncome(source)}
                          className="hidden rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 group-hover:block"
                        >
                          <Trash2 size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <Card>
        <CardTitle>How shared costs are split</CardTitle>
        <div className="space-y-2">
          {(
            [
              ['proportional', 'By income', 'Bigger paycheck, bigger share — proportional to monthly income.'],
              ['equal', '50 / 50', 'Straight down the middle, every month.'],
              ['custom', 'Custom', 'Set your own percentages.'],
            ] as [SplitRule, string, string][]
          ).map(([value, label, blurb]) => (
            <label
              key={value}
              className={cls(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-3',
                rule === value ? 'border-violet-300 bg-violet-50/60' : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <input
                type="radio"
                checked={rule === value}
                onChange={() => setRule(value)}
                className="mt-0.5 h-4 w-4 border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-slate-500">{blurb}</span>
              </span>
            </label>
          ))}
        </div>
        {rule === 'custom' && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {me.household.members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <Avatar name={m.name} color={m.color} size={22} />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={customSplit[m.id] ?? 0}
                  onChange={(e) => setCustomSplit({ ...customSplit, [m.id]: Number(e.target.value) })}
                  className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm"
                />
                %
              </label>
            ))}
            {customTotal !== 100 && <span className="text-xs text-amber-600">Adds up to {customTotal}% — needs 100%.</span>}
          </div>
        )}
        <div className="mt-3">
          <Button variant="secondary" onClick={() => void saveHousehold()} disabled={rule === 'custom' && customTotal !== 100}>
            {savedNote ? <Check size={14} /> : null} Save split rule
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Calendar feed</CardTitle>
        <p className="mb-3 text-sm text-slate-500">
          Add this URL in Google Calendar (<em>Other calendars → From URL</em>) and your trips, stops, and dated to-dos
          appear on both of your calendars. It updates automatically.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="max-w-full flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-xs">{calendarUrl}</code>
          <Button variant="secondary" onClick={() => void copyUrl()}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="ghost" onClick={() => void rotateToken()} className="text-xs">
            <RefreshCw size={13} /> New link
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Integrations</CardTitle>
        <p className="mb-3 text-sm text-slate-500">
          The Fold is built to be the hub of your self-hosted setup. Here’s what’s wired up and what’s on the bench —
          details live in <code className="rounded bg-slate-100 px-1">docs/INTEGRATIONS.md</code>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {INTEGRATIONS.map((integration) => (
            <div key={integration.name} className="rounded-xl border border-slate-200 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {integration.emoji} {integration.name}
                </p>
                <Chip className={integration.status === 'live' ? 'bg-emerald-100 text-emerald-700' : undefined}>
                  {integration.status === 'live' ? 'Live' : 'Planned'}
                </Chip>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">{integration.blurb}</p>
            </div>
          ))}
        </div>
      </Card>

      {incomeModal.open && (
        <IncomeModal
          existing={incomeModal.source}
          defaultUserId={me.user.id}
          onClose={() => setIncomeModal({ open: false, source: null })}
          onSaved={() => {
            setIncomeModal({ open: false, source: null })
            income.reload()
            void reloadMe()
          }}
        />
      )}
    </div>
  )
}
