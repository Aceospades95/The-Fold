import { useEffect, useState } from 'react'
import type {
  ApiTokenInfo,
  BudgetMethod,
  HaConfig,
  IncomeSource,
  InviteInfo,
  MethodConfig,
  PayDeduction,
  SplitBasis,
  SplitRule,
} from '@fold/shared'
import { CADENCES, MEMBER_COLOR_LABELS, MEMBER_PALETTE, METHOD_LABELS, monthlyCents } from '@fold/shared'
import { Check, Copy, Download, KeyRound, Link2, Moon, Monitor, Pencil, Plus, RefreshCw, ShieldCheck, Sun, Sunrise, Trash2, UserPlus } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { fmtMoney } from '../format'
import { ACCENTS, applyTheme, loadTheme, type ThemeMode, type ThemePref } from '../theme'
import { Avatar, Button, Card, CardTitle, Chip, ErrorNote, Field, Modal, MoneyInput, NumberInput, Select, TextInput, cls } from '../ui'

function AccountCard() {
  const { me, reloadMe } = useMe()
  const sessions = useApi<{ sessions: { created_at: string; expires_at: string; current: boolean }[] }>('/auth/sessions')
  const [name, setName] = useState(me.user.name)
  const [email, setEmail] = useState(me.user.email)
  const [profileNote, setProfileNote] = useState<string | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordNote, setPasswordNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function saveProfile(): Promise<void> {
    setError(null)
    try {
      await api.patch('/auth/profile', { name: name.trim(), email: email.trim() })
      await reloadMe()
      setProfileNote('Saved.')
      setTimeout(() => setProfileNote(null), 2000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function changePassword(): Promise<void> {
    setError(null)
    if (next !== confirm) {
      setError('New passwords don’t match.')
      return
    }
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next })
      setCurrent('')
      setNext('')
      setConfirm('')
      sessions.reload()
      setPasswordNote('Password changed — every other device was signed out.')
      setTimeout(() => setPasswordNote(null), 5000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function pickColor(color: string): Promise<void> {
    if (color === me.user.color) return
    setError(null)
    try {
      await api.patch('/auth/profile', { color })
      await reloadMe()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function signOutOthers(): Promise<void> {
    const result = await api.post<{ signed_out: number }>('/auth/logout-others')
    sessions.reload()
    setPasswordNote(
      result.signed_out === 0 ? 'No other devices were signed in.' : `Signed out ${result.signed_out} other ${result.signed_out === 1 ? 'device' : 'devices'}.`,
    )
    setTimeout(() => setPasswordNote(null), 4000)
  }

  const activeSessions = sessions.data?.sessions ?? []
  const otherCount = activeSessions.filter((s) => !s.current).length

  return (
    <Card>
      <CardTitle>Your account</CardTitle>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} className="w-44" />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-60" />
        </Field>
        <Button variant="secondary" onClick={() => void saveProfile()} disabled={!name.trim() || !email.trim()}>
          {profileNote ? <Check size={14} /> : null} Save
        </Button>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="mb-2 text-sm font-semibold text-slate-700">Your color</p>
        <div className="flex flex-wrap items-center gap-2">
          {MEMBER_PALETTE.map((color) => {
            const takenBy = me.household.members.find((m) => m.id !== me.user.id && m.color === color)
            const selected = me.user.color === color
            return (
              <button
                key={color}
                title={takenBy ? `${takenBy.name} uses ${MEMBER_COLOR_LABELS[color]}` : MEMBER_COLOR_LABELS[color]}
                disabled={Boolean(takenBy)}
                onClick={() => void pickColor(color)}
                className={cls(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-transform',
                  takenBy ? 'cursor-not-allowed opacity-30' : 'hover:scale-110',
                  selected && 'ring-2 ring-slate-400 ring-offset-2',
                )}
                style={{ backgroundColor: color }}
              >
                {selected && <Check size={14} className="text-on-accent" />}
              </button>
            )
          })}
          <p className="ml-1 text-xs text-slate-400">Marks you on charts, splits, and avatars everywhere.</p>
        </div>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <KeyRound size={14} /> Change password
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Current password">
            <TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className="w-44" autoComplete="current-password" />
          </Field>
          <Field label="New password" hint="At least 6 characters.">
            <TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={6} className="w-44" autoComplete="new-password" />
          </Field>
          <Field label="Repeat it">
            <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-44" autoComplete="new-password" />
          </Field>
          <Button variant="secondary" onClick={() => void changePassword()} disabled={!current || next.length < 6}>
            Change
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
        <p className="text-sm text-slate-600">
          <strong>{activeSessions.length}</strong> signed-in {activeSessions.length === 1 ? 'device' : 'devices'}
          {otherCount > 0 && <span className="text-slate-400"> · {otherCount} besides this one</span>}
        </p>
        {otherCount > 0 && (
          <Button variant="secondary" onClick={() => void signOutOthers()}>
            Sign out everywhere else
          </Button>
        )}
      </div>
      {passwordNote && <p className="mt-2 text-sm font-medium text-emerald-600">{passwordNote}</p>}
      <ErrorNote message={error} />
    </Card>
  )
}

interface SimplefinStatus {
  connected: boolean
  connected_at?: string
  last_sync?: string | null
  last_error?: string | null
  accounts?: { sfin_name: string; account_id: string; account_name: string }[]
}

function SimplefinCard() {
  const { data, reload } = useApi<SimplefinStatus>('/simplefin')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!data) return null

  async function connect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ connected: boolean; imported?: number; error?: string }>('/simplefin/connect', {
        setup_token: token.trim(),
      })
      setToken('')
      setNote(
        r.error
          ? `Connected, but the first sync hit a snag: ${r.error}`
          : `Connected — pulled ${r.imported ?? 0} transaction${r.imported === 1 ? '' : 's'} from the last 90 days.`,
      )
      reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function syncNow(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ imported: number; skipped: number }>('/simplefin/sync')
      setNote(`Synced: ${r.imported} new, ${r.skipped} already in.`)
      reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function disconnect(): Promise<void> {
    if (!confirm('Disconnect SimpleFIN? Everything already imported stays; new transactions stop arriving.')) return
    await api.delete('/simplefin')
    setNote(null)
    reload()
  }

  return (
    <Card>
      <CardTitle>Bank sync (SimpleFIN)</CardTitle>
      {data.connected ? (
        <>
          <p className="mb-2 text-sm text-slate-500">
            Connected. New posted transactions pull themselves about once a day (each pull is an undoable import batch
            headed for the classify queue), and balances update on the Net worth page.
          </p>
          <div className="mb-3 divide-y divide-slate-100">
            {(data.accounts ?? []).map((account) => (
              <div key={account.account_id} className="flex items-center gap-2 py-1.5 text-sm">
                <Link2 size={13} className="shrink-0 text-slate-400" />
                <span className="text-slate-500">{account.sfin_name}</span>
                <span className="text-slate-300">→</span>
                <span className="font-medium">{account.account_name}</span>
              </div>
            ))}
          </div>
          <p className="mb-2 text-xs text-slate-400">
            Last sync: {data.last_sync ? new Date(data.last_sync).toLocaleString() : 'never'}
            {data.last_error && <span className="ml-2 font-medium text-amber-600">Last error: {data.last_error}</span>}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void syncNow()} disabled={busy}>
              <RefreshCw size={14} /> {busy ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button variant="secondary" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500">
            Real bank data without handing anyone your credentials: create an account at{' '}
            <a href="https://bridge.simplefin.org" target="_blank" rel="noreferrer" className="underline">
              bridge.simplefin.org
            </a>{' '}
            (about $1.50/month), connect your banks there, then paste the one-time <b>setup token</b> it gives you.
            The Fold claims it, auto-creates matching accounts, and pulls posted transactions daily from then on.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your SimpleFIN setup token"
              className="w-full max-w-md font-mono text-xs"
            />
            <Button onClick={() => void connect()} disabled={busy || token.trim().length < 8}>
              {busy ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </>
      )}
      {note && <p className="mt-2 text-sm font-medium text-emerald-600">{note}</p>}
      <ErrorNote message={error} />
    </Card>
  )
}

function DataCard() {
  const { me } = useMe()
  const rows: { href: string; title: string; blurb: string; adminOnly?: boolean }[] = [
    {
      href: '/api/export/full.json',
      title: 'Everything as JSON',
      blurb: 'Budgets, spending, trips, lists — the full household, machine-readable.',
    },
    {
      href: '/api/export/transactions.csv',
      title: 'Transactions as CSV',
      blurb: 'Every expense with categories, splits, and accounts — opens in any spreadsheet.',
    },
    {
      href: '/api/export/backup.sqlite',
      title: 'Database backup',
      blurb: 'A consistent copy of the SQLite file. Restoring = dropping it back into ./data.',
      adminOnly: true,
    },
  ]
  return (
    <Card>
      <CardTitle>Your data</CardTitle>
      <p className="mb-3 text-sm text-slate-500">It’s yours — take it whenever you like.</p>
      <div className="divide-y divide-slate-100">
        {rows
          .filter((row) => !row.adminOnly || me.user.is_admin === 1)
          .map((row) => (
            <a key={row.href} href={row.href} download className="group flex items-center gap-3 py-2.5">
              <Download size={16} className="shrink-0 text-slate-400 group-hover:text-violet-600" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium group-hover:text-violet-700">{row.title}</span>
                <span className="block text-xs text-slate-500">{row.blurb}</span>
              </span>
            </a>
          ))}
      </div>
    </Card>
  )
}

const DEDUCTION_KINDS: { value: PayDeduction['kind']; label: string }[] = [
  { value: 'tax', label: 'Taxes' },
  { value: 'pretax', label: 'Pre-tax (401k, insurance…)' },
  { value: 'posttax', label: 'Post-tax' },
]

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
  const [cadence, setCadence] = useState(existing?.cadence ?? 'biweekly')
  const [detailed, setDetailed] = useState(existing?.gross_cents != null)
  const [net, setNet] = useState<number | null>(existing?.amount_cents ?? null)
  const [gross, setGross] = useState<number | null>(existing?.gross_cents ?? null)
  const [deductions, setDeductions] = useState<{ name: string; amount_cents: number | null; kind: PayDeduction['kind'] }[]>(
    existing?.deductions?.map((d) => ({ ...d })) ?? [
      { name: 'Federal tax', amount_cents: null, kind: 'tax' },
      { name: '401(k)', amount_cents: null, kind: 'pretax' },
    ],
  )
  const [error, setError] = useState<string | null>(null)

  const deductionTotal = deductions.reduce((sum, d) => sum + (d.amount_cents ?? 0), 0)
  const computedNet = detailed && gross != null ? gross - deductionTotal : net
  const valid =
    name.trim().length > 0 &&
    (detailed ? gross != null && gross > 0 && computedNet != null && computedNet >= 0 : net != null && net > 0)

  async function save(): Promise<void> {
    if (!valid) return
    const cleanDeductions = detailed
      ? deductions
          .filter((d) => d.name.trim() && (d.amount_cents ?? 0) > 0)
          .map((d) => ({ name: d.name.trim(), amount_cents: d.amount_cents!, kind: d.kind }))
      : null
    const body = {
      name: name.trim(),
      cadence,
      amount_cents: computedNet!,
      gross_cents: detailed ? gross : null,
      deductions: cleanDeductions,
    }
    try {
      if (existing) {
        await api.patch(`/income/${existing.id}`, body)
      } else {
        await api.post('/income', { user_id: userId, ...body })
      }
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title={existing ? 'Edit income' : 'Add income'} onClose={onClose} wide={detailed}>
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Salary, side gig…" />
          </Field>
          <Field label="How often">
            <Select value={cadence} onChange={(e) => setCadence(e.target.value as IncomeSource['cadence'])}>
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
          </Field>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
          <input
            type="checkbox"
            checked={detailed}
            onChange={(e) => setDetailed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600"
          />
          <span>
            <span className="block text-sm font-medium">Add the paycheck breakdown</span>
            <span className="block text-xs text-slate-500">
              Gross pay and deductions (taxes, 401k, insurance) — unlocks splitting by gross vs net.
            </span>
          </span>
        </label>

        {detailed ? (
          <>
            <Field label="Gross per paycheck">
              <MoneyInput cents={gross} onCents={setGross} />
            </Field>
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">Deductions per paycheck</p>
              <div className="space-y-2">
                {deductions.map((deduction, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <TextInput
                      value={deduction.name}
                      onChange={(e) =>
                        setDeductions((prev) => prev.map((d, i) => (i === index ? { ...d, name: e.target.value } : d)))
                      }
                      placeholder="Federal tax"
                      className="min-w-0 flex-1"
                    />
                    <Select
                      value={deduction.kind}
                      onChange={(e) =>
                        setDeductions((prev) =>
                          prev.map((d, i) => (i === index ? { ...d, kind: e.target.value as PayDeduction['kind'] } : d)),
                        )
                      }
                      className="!w-40 shrink-0"
                    >
                      {DEDUCTION_KINDS.map((kind) => (
                        <option key={kind.value} value={kind.value}>{kind.label}</option>
                      ))}
                    </Select>
                    <div className="w-28 shrink-0">
                      <MoneyInput
                        cents={deduction.amount_cents}
                        onCents={(cents) =>
                          setDeductions((prev) => prev.map((d, i) => (i === index ? { ...d, amount_cents: cents } : d)))
                        }
                      />
                    </div>
                    <button
                      onClick={() => setDeductions((prev) => prev.filter((_, i) => i !== index))}
                      className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setDeductions((prev) => [...prev, { name: '', amount_cents: null, kind: 'tax' }])}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline"
              >
                <Plus size={12} /> Add deduction
              </button>
            </div>
            {gross != null && (
              <p
                className={cls(
                  'rounded-lg px-3 py-2 text-sm',
                  computedNet != null && computedNet >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
                )}
              >
                Take-home: <strong>{fmtMoney(Math.max(0, computedNet ?? 0))}</strong> per paycheck ≈{' '}
                <strong>{fmtMoney(monthlyCents(Math.max(0, computedNet ?? 0), cadence))}</strong> / month
                {computedNet != null && computedNet < 0 && ' — deductions exceed gross'}
              </p>
            )}
          </>
        ) : (
          <>
            <Field label="Take-home per paycheck" hint="What actually lands in the bank.">
              <MoneyInput cents={net} onCents={setNet} />
            </Field>
            {net != null && net > 0 && (
              <p className="text-sm text-slate-600">≈ {fmtMoney(monthlyCents(net, cadence))} per month</p>
            )}
          </>
        )}

        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!valid}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}

interface InstanceUser {
  id: string
  name: string
  email: string
  color: string
  is_admin: 0 | 1
  created_at: string
  household_id: string
  household_name: string
  household_members: number
  last_login: string | null
}

function ServerCard() {
  const { me } = useMe()
  const { data, reload } = useApi<{ open_signup: boolean; users: number; households: number; version?: string }>(
    me.user.is_admin === 1 ? '/instance' : null,
  )
  const accounts = useApi<{ users: InstanceUser[] }>(me.user.is_admin === 1 ? '/instance/users' : null)
  const [resetResult, setResetResult] = useState<{ name: string; temp_password: string } | null>(null)
  if (me.user.is_admin !== 1 || !data) return null

  async function toggle(next: boolean): Promise<void> {
    await api.patch('/instance', { open_signup: next })
    reload()
  }

  async function resetPassword(userId: string, name: string): Promise<void> {
    if (!confirm(`Reset ${name}'s password? Their current password stops working everywhere and you'll get a one-time password to read to them.`)) return
    const r = await api.post<{ name: string; temp_password: string }>('/instance/reset-password', { user_id: userId })
    setResetResult(r)
  }

  const rows = accounts.data?.users ?? []

  return (
    <Card>
      <CardTitle>Server</CardTitle>
      <p className="mb-3 flex items-center gap-1.5 text-sm text-slate-500">
        <ShieldCheck size={15} className="text-emerald-600" />
        You're the server admin ({data.users} {data.users === 1 ? 'account' : 'accounts'},{' '}
        {data.households} {data.households === 1 ? 'household' : 'households'}
        {data.version ? ` · v${data.version}` : ''}).
      </p>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
        <input
          type="checkbox"
          checked={data.open_signup}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600"
        />
        <span>
          <span className="block text-sm font-medium">Allow open signup</span>
          <span className="block text-xs text-slate-500">
            Off (recommended): only invite codes can create new accounts. On: anyone who can reach this server can sign
            up. Invite codes always work either way — entering one links the new account into the inviter's household.
          </span>
        </span>
      </label>

      {rows.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Accounts on this server
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="py-1.5 pr-3 font-medium">Person</th>
                  <th className="py-1.5 pr-3 font-medium">Household</th>
                  <th className="py-1.5 pr-3 font-medium">Joined</th>
                  <th className="py-1.5 pr-3 font-medium">Last sign-in</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <Avatar name={row.name} color={row.color} size={24} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-medium">
                            {row.name}
                            {row.is_admin === 1 && (
                              <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600">
                                admin
                              </span>
                            )}
                            {row.id === me.user.id && <span className="text-xs font-normal text-slate-400">(you)</span>}
                          </span>
                          <span className="block truncate text-xs text-slate-400">{row.email}</span>
                        </span>
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-500">
                      {row.household_name}
                      <span className="text-slate-400">
                        {' '}
                        · {row.household_members} {row.household_members === 1 ? 'person' : 'people'}
                      </span>
                      {row.household_members === 1 && row.household_id !== me.household.id && (
                        <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          not linked
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs tabular-nums text-slate-500">{row.created_at.slice(0, 10)}</td>
                    <td className="py-2 pr-3 text-xs tabular-nums text-slate-500">
                      {row.last_login ? row.last_login.slice(0, 10) : 'never'}
                    </td>
                    <td className="py-2 text-right">
                      {row.id !== me.user.id && (
                        <Button variant="secondary" onClick={() => void resetPassword(row.id, row.name)} className="!px-2.5 !py-1 text-xs">
                          <KeyRound size={12} /> Reset password
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.some((row) => row.household_members === 1 && row.household_id !== me.household.id) && (
            <p className="mt-2 text-xs text-slate-400">
              "Not linked" means that account lives in its own household. They can join yours anytime: generate an
              invite code under Link your partner, they sign in and enter it in the same place — their budget merges in.
            </p>
          )}
          {resetResult && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {resetResult.name}'s one-time password is{' '}
              <code className="rounded bg-white px-1.5 py-0.5 font-semibold">{resetResult.temp_password}</code> — read
              it to them now (it won't be shown again) and have them pick their own under Settings, Your account.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

function AppearanceCard() {
  const [pref, setPref] = useState<ThemePref>(loadTheme())

  function update(next: ThemePref): void {
    setPref(next)
    applyTheme(next)
  }

  const modes: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'auto', label: 'Auto', icon: Sunrise },
  ]

  return (
    <Card>
      <CardTitle>Appearance</CardTitle>
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Mode</p>
          <div className="flex rounded-xl bg-slate-100 p-1">
            {modes.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => update({ ...pref, mode: value })}
                className={cls(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  pref.mode === value ? 'bg-white shadow-sm' : 'text-slate-500',
                )}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Accent</p>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((accent) => (
              <button
                key={accent.value}
                title={accent.label}
                onClick={() => update({ ...pref, accent: accent.value })}
                className={cls(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110',
                  pref.accent === accent.value && 'ring-2 ring-slate-400 ring-offset-2',
                )}
                style={{ backgroundColor: accent.swatch }}
              >
                {pref.accent === accent.value && <Check size={14} className="text-on-accent" />}
              </button>
            ))}
          </div>
        </div>
        <p className="max-w-52 text-xs text-slate-400">
          {pref.mode === 'auto'
            ? 'Auto follows the clock — light through the day, dark from 7pm to 7am.'
            : 'Saved on this device — you can each pick your own look.'}
        </p>
      </div>
    </Card>
  )
}

function PartnerCard() {
  const { me, reloadMe } = useMe()
  const invites = useApi<{ invites: InviteInfo[] }>('/invites')
  const [redeemCode, setRedeemCode] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState(false)
  const [manualForm, setManualForm] = useState({ name: '', email: '', password: '' })
  const solo = me.household.members.length < 2

  async function generate(): Promise<void> {
    setError(null)
    try {
      await api.post('/invites')
      invites.reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function copy(code: string): Promise<void> {
    await navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 2000)
  }

  async function redeem(): Promise<void> {
    setError(null)
    try {
      await api.post('/invites/redeem', { code: redeemCode })
      // The whole household changed underneath us — reload everything.
      window.location.reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function addManual(): Promise<void> {
    setError(null)
    try {
      await api.post('/household/members', manualForm)
      await reloadMe()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (me.household.members.length >= 4) return null

  return (
    <Card>
      <CardTitle>{solo ? 'Link your partner' : 'Invite someone to this household'}</CardTitle>
      <div className={cls('grid gap-5', solo && 'md:grid-cols-2')}>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">
            <UserPlus size={14} className="mr-1 inline" /> Invite {solo ? 'them' : 'with a code'}
          </p>
          <p className="text-xs text-slate-500">
            Send a code — they create their own login with it (or redeem it from their existing solo account) and your
            budgets link into one household. Their solo history comes along as their personal envelopes.
          </p>
          {(invites.data?.invites ?? []).map((invite) => (
            <div key={invite.code} className="flex items-center gap-2">
              <code className="rounded-lg bg-violet-50 px-3 py-1.5 text-base font-bold tracking-widest text-violet-700">
                {invite.code}
              </code>
              <Button variant="secondary" onClick={() => void copy(invite.code)}>
                {copied === invite.code ? <Check size={14} /> : <Copy size={14} />}
              </Button>
              <span className="text-xs text-slate-400">expires {invite.expires_at.slice(0, 10)}</span>
            </div>
          ))}
          {(invites.data?.invites ?? []).length === 0 && (
            <Button variant="secondary" onClick={() => void generate()}>
              Generate invite code
            </Button>
          )}
        </div>

        {solo && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">
              <Link2 size={14} className="mr-1 inline" /> Got a code yourself?
            </p>
            <p className="text-xs text-slate-500">
              Enter your partner's code and this account joins their household — your budget here merges in as your
              personal envelopes.
            </p>
            <div className="flex gap-2">
              <TextInput
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value)}
                placeholder="XXXX-XXXX"
                className="w-40 uppercase tracking-widest"
              />
              <Button onClick={() => void redeem()} disabled={redeemCode.trim().length < 4}>
                Link
              </Button>
            </div>
          </div>
        )}
      </div>

      <button onClick={() => setManual((v) => !v)} className="mt-4 text-xs text-slate-400 hover:text-slate-600">
        {manual ? 'Hide' : 'Or create their login yourself →'}
      </button>
      {manual && (
        <div className="mt-2 space-y-3 rounded-xl border border-dashed border-slate-300 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <TextInput value={manualForm.name} onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })} placeholder="Name" />
            <TextInput type="email" value={manualForm.email} onChange={(e) => setManualForm({ ...manualForm, email: e.target.value })} placeholder="Email" />
            <TextInput type="password" value={manualForm.password} onChange={(e) => setManualForm({ ...manualForm, password: e.target.value })} placeholder="Temp password" />
          </div>
          <Button variant="secondary" onClick={() => void addManual()} disabled={!manualForm.name || !manualForm.email || manualForm.password.length < 6}>
            <Plus size={14} /> Add partner
          </Button>
        </div>
      )}
      <ErrorNote message={error} />
    </Card>
  )
}

const METHOD_DETAILS: { value: BudgetMethod; blurb: string }[] = [
  { value: 'envelope', blurb: 'Assign every dollar to an envelope; each one tracks what’s left. The most control (YNAB-style).' },
  { value: 'fifty_thirty_twenty', blurb: 'Keep needs, wants, and savings inside percentage lines of your take-home. Adjust the percentages to taste.' },
  { value: 'pay_yourself_first', blurb: 'Fund savings first, then spend the rest guilt-free — one number to watch.' },
  { value: 'tracker', blurb: 'No limits, just awareness: income in, spending out, and what you kept.' },
]

function BudgetMethodCard() {
  const { me, reloadMe } = useMe()
  const [method, setMethod] = useState<BudgetMethod>(me.household.budget_method)
  const [config, setConfig] = useState<MethodConfig>({ ...me.household.method_config })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pctTotal = config.needs_pct + config.wants_pct + config.savings_pct
  const pctInvalid = method === 'fifty_thirty_twenty' && pctTotal !== 100

  async function save(): Promise<void> {
    setError(null)
    try {
      await api.patch('/household', { budget_method: method, method_config: config })
      await reloadMe()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Card>
      <CardTitle>Budgeting method</CardTitle>
      <p className="mb-3 text-sm text-slate-500">
        Same money, same envelopes underneath — this changes how the Budget page frames your month. Switch anytime;
        nothing is lost.
      </p>
      <div className="space-y-2">
        {METHOD_DETAILS.map(({ value, blurb }) => (
          <label
            key={value}
            className={cls(
              'flex cursor-pointer items-start gap-3 rounded-xl border p-3',
              method === value ? 'border-violet-300 bg-violet-50/60' : 'border-slate-200 hover:border-slate-300',
            )}
          >
            <input
              type="radio"
              checked={method === value}
              onChange={() => setMethod(value)}
              className="mt-0.5 h-4 w-4 border-slate-300 text-violet-600 focus:ring-violet-500"
            />
            <span className="flex-1">
              <span className="block text-sm font-medium">{METHOD_LABELS[value]}</span>
              <span className="block text-xs text-slate-500">{blurb}</span>

              {value === 'fifty_thirty_twenty' && method === 'fifty_thirty_twenty' && (
                <span className="mt-2 flex flex-wrap items-center gap-3">
                  {(
                    [
                      ['needs_pct', 'Needs'],
                      ['wants_pct', 'Wants'],
                      ['savings_pct', 'Savings'],
                    ] as ['needs_pct' | 'wants_pct' | 'savings_pct', string][]
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
                      {label}
                      <NumberInput
                        value={config[key]}
                        onValue={(v) => setConfig({ ...config, [key]: Math.min(100, v) })}
                        className="w-14 rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-right text-xs"
                      />
                      %
                    </label>
                  ))}
                  {pctInvalid && <span className="text-xs text-amber-600">adds up to {pctTotal}% — needs 100%</span>}
                </span>
              )}

              {value === 'pay_yourself_first' && method === 'pay_yourself_first' && (
                <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  Monthly savings goal
                  <span className="w-32">
                    <MoneyInput
                      cents={config.savings_target_cents}
                      onCents={(cents) => setConfig({ ...config, savings_target_cents: cents })}
                    />
                  </span>
                  <span className="text-slate-400">leave empty to use {config.savings_pct}% of take-home</span>
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
      <ErrorNote message={error} />
      <div className="mt-3">
        <Button variant="secondary" onClick={() => void save()} disabled={pctInvalid}>
          {saved ? <Check size={14} /> : null} Save method
        </Button>
      </div>
    </Card>
  )
}

function HomeAssistantCard() {
  const { data, reload } = useApi<HaConfig>('/integrations/ha')
  const [url, setUrl] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shownUrl = url ?? data?.url ?? ''

  async function save(events?: Partial<HaConfig['events']>): Promise<void> {
    setError(null)
    try {
      await api.patch('/integrations/ha', { url: shownUrl.trim() || null, events })
      setNote('Saved')
      setTimeout(() => setNote(null), 2000)
      reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function test(): Promise<void> {
    setError(null)
    setNote(null)
    try {
      await api.post('/integrations/ha/test')
      setNote('Webhook reached Home Assistant — success')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const events = data?.events ?? { item_due: true, trip_countdown: true, budget_over: true }
  const eventLabels: [keyof HaConfig['events'], string][] = [
    ['item_due', 'Chores & to-dos due'],
    ['trip_countdown', 'Trip countdown (7/3/1 days & departure)'],
    ['budget_over', 'Budget category goes over'],
  ]

  return (
    <Card>
      <CardTitle>Home Assistant</CardTitle>
      <p className="mb-3 text-sm text-slate-500">
        In HA, add an <em>Automation → Trigger → Webhook</em> and paste its URL here (looks like{' '}
        <code className="rounded bg-slate-100 px-1 text-xs">http://homeassistant.local:8123/api/webhook/…</code>). The
        Fold POSTs JSON events; your automations decide what happens — lights, announcements, anything.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          value={shownUrl}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://homeassistant.local:8123/api/webhook/the-fold"
          className="min-w-64 flex-1"
        />
        <Button variant="secondary" onClick={() => void save()}>
          {note === 'Saved' ? <Check size={14} /> : null} Save
        </Button>
        <Button variant="ghost" onClick={() => void test()} disabled={!data?.url}>
          Send test
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {eventLabels.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={events[key]}
              onChange={(e) => void save({ [key]: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-violet-600"
            />
            {label}
          </label>
        ))}
      </div>
      {note && note !== 'Saved' && <p className="mt-2 text-sm text-emerald-600">{note}</p>}
      <ErrorNote message={error} />
    </Card>
  )
}

function ApiTokensCard() {
  const { data, reload } = useApi<{ tokens: ApiTokenInfo[] }>('/integrations/tokens')
  const [name, setName] = useState('')
  const [freshToken, setFreshToken] = useState<string | null>(null)

  async function create(): Promise<void> {
    const result = await api.post<{ token: string }>('/integrations/tokens', { name: name.trim() })
    setFreshToken(result.token)
    setName('')
    reload()
  }

  async function revoke(token: ApiTokenInfo): Promise<void> {
    if (!confirm(`Revoke "${token.name}"? Anything using it stops working.`)) return
    await api.delete(`/integrations/tokens/${token.id}`)
    reload()
  }

  return (
    <Card>
      <CardTitle>API tokens</CardTitle>
      <p className="mb-3 text-sm text-slate-500">
        Long-lived tokens for Home Assistant, Siri/Google shortcuts, and scripts. They can add list items (
        <code className="rounded bg-slate-100 px-1 text-xs">POST /api/hooks/list-items</code>), complete items, and read
        a small summary — nothing else.
      </p>
      {freshToken && (
        <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-800">Copy this now — it won't be shown again:</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">{freshToken}</code>
          <button onClick={() => setFreshToken(null)} className="mt-1 text-xs text-amber-700 hover:underline">
            done
          </button>
        </div>
      )}
      {(data?.tokens ?? []).length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100">
          {(data?.tokens ?? []).map((token) => (
            <li key={token.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="flex-1 font-medium">{token.name}</span>
              <span className="text-xs text-slate-400">
                {token.last_used_at ? `last used ${token.last_used_at.slice(0, 10)}` : 'never used'}
              </span>
              <Button variant="ghost" onClick={() => void revoke(token)} className="!px-2 !py-1 text-xs text-red-500">
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Home Assistant"
          className="w-56"
        />
        <Button variant="secondary" onClick={() => void create()} disabled={!name.trim()}>
          <Plus size={14} /> Create token
        </Button>
      </div>
    </Card>
  )
}

const INTEGRATIONS: { name: string; status: 'live' | 'planned'; blurb: string }[] = [
  { name: 'Google Calendar (feed)', status: 'live', blurb: 'Subscribe to the calendar feed below — trips, stops, and due dates show up automatically.' },
  { name: 'CSV statement import', status: 'live', blurb: 'Import bank/card exports on the Spending page — with auto-rules and duplicate detection.' },
  { name: 'Net worth tracking', status: 'live', blurb: 'Accounts, investments, and debts with balance history — see the Net worth page.' },
  { name: 'Google Calendar & Tasks (two-way)', status: 'planned', blurb: 'OAuth per person: create real events on a shared calendar, sync assigned to-dos to Google Tasks.' },
  { name: 'Email reminders', status: 'planned', blurb: 'Digest + nudges from your own Gmail or a dedicated app account via SMTP.' },
  { name: 'Bank sync (SimpleFIN)', status: 'live', blurb: 'Posted transactions and balances pull themselves daily — connect it in the Bank sync card above.' },
  { name: 'Tandoor Recipes', status: 'planned', blurb: 'Pick recipes for the week and push ingredients straight onto the grocery list.' },
  { name: 'Plex + Overseerr date night', status: 'planned', blurb: 'Queue a movie, dim the lights, dinner from Tandoor — one button.' },
  { name: 'Shy Local', status: 'planned', blurb: 'Pull date ideas from your activity planner into the trip/date wishlist.' },
]

export default function Settings() {
  const { me, reloadMe } = useMe()
  const income = useApi<{ sources: IncomeSource[] }>('/income')
  const [householdName, setHouseholdName] = useState(me.household.name)
  const [rule, setRule] = useState<SplitRule>(me.household.split_rule)
  const [basis, setBasis] = useState<SplitBasis>(me.household.split_basis)
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

  useEffect(() => {
    const anchor = window.location.hash.slice(1)
    if (!anchor) return
    const t = setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' }), 120)
    return () => clearTimeout(t)
  }, [])

  async function saveHousehold(): Promise<void> {
    await api.patch('/household', {
      name: householdName,
      split_rule: rule,
      split_basis: basis,
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

      <AccountCard />
      <AppearanceCard />
      <ServerCard />
      <div id="partner" className="scroll-mt-4" />
      <PartnerCard />

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
      </Card>

      <div id="income" className="scroll-mt-4" />
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
          Each person’s paychecks. Add the gross &amp; deductions breakdown to unlock net-vs-gross splitting and the
          full picture on the Budget page.
        </p>
        <div className="space-y-4">
          {me.household.members.map((member) => {
            const sources = (income.data?.sources ?? []).filter((s) => s.user_id === member.id)
            return (
              <div key={member.id}>
                <div className="mb-1.5 flex items-center gap-2">
                  <Avatar name={member.name} color={member.color} size={22} />
                  <span className="text-sm font-semibold">{member.name}</span>
                  <span className="text-xs text-slate-500">
                    {fmtMoney(member.monthly_income_cents)} / mo take-home
                    {member.monthly_gross_cents > member.monthly_income_cents &&
                      ` · ${fmtMoney(member.monthly_gross_cents)} gross`}
                  </span>
                </div>
                {sources.length === 0 ? (
                  <p className="ml-8 text-sm text-slate-400">No income added yet.</p>
                ) : (
                  <ul className="ml-8 divide-y divide-slate-100">
                    {sources.map((source) => (
                      <li key={source.id} className="group flex items-center gap-2 py-1.5 text-sm">
                        <span className="flex-1">
                          {source.name}
                          {source.gross_cents != null && (
                            <Chip className="ml-2 bg-violet-50 text-violet-700">breakdown</Chip>
                          )}
                        </span>
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

      <BudgetMethodCard />

      <Card>
        <CardTitle>How shared costs are split</CardTitle>
        <div className="space-y-2">
          {(
            [
              ['proportional', 'By income', 'Bigger paycheck, bigger share — proportional to income.'],
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
              <span className="flex-1">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-slate-500">{blurb}</span>
                {value === 'proportional' && rule === 'proportional' && (
                  <span className="mt-2 flex gap-4">
                    {(
                      [
                        ['net', 'on take-home (net)'],
                        ['gross', 'on gross pay'],
                      ] as [SplitBasis, string][]
                    ).map(([b, blabel]) => (
                      <label key={b} className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                          type="radio"
                          checked={basis === b}
                          onChange={() => setBasis(b)}
                          className="h-3.5 w-3.5 border-slate-300 text-violet-600"
                        />
                        {blabel}
                      </label>
                    ))}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
        {rule === 'custom' && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {me.household.members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <Avatar name={m.name} color={m.color} size={22} />
                <NumberInput
                  value={customSplit[m.id] ?? 0}
                  onValue={(v) => setCustomSplit({ ...customSplit, [m.id]: Math.min(100, v) })}
                  className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right text-sm"
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

      <SimplefinCard />
      <HomeAssistantCard />
      <ApiTokensCard />
      <DataCard />

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
                  {integration.name}
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
