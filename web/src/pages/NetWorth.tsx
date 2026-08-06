import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AccountRow, AccountType, NetWorthPoint, NetWorthResponse } from '@fold/shared'
import { ACCOUNT_TYPE_LABELS, LIABILITY_TYPES } from '@fold/shared'
import { Archive, Plus } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { centsToInput, fmtDate, fmtMoney, parseMoney } from '../format'
import { Avatar, Button, Card, CardTitle, Chip, EmptyState, ErrorNote, Field, Modal, MoneyInput, Select, TextInput, cls, inputCls } from '../ui'

function NetWorthChart({ history }: { history: NetWorthPoint[] }) {
  if (history.length < 2) {
    return <p className="py-6 text-center text-sm text-slate-400">Update balances over a couple of months and the trend shows up here.</p>
  }
  const width = 640
  const height = 160
  const pad = 8
  const values = history.map((h) => h.net_cents)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const x = (index: number) => pad + (index * (width - pad * 2)) / (history.length - 1)
  const y = (value: number) => height - pad - ((value - min) * (height - pad * 2)) / range
  const points = history.map((h, i) => `${x(i)},${y(h.net_cents)}`).join(' ')
  const area = `${pad},${height - pad} ${points} ${width - pad},${height - pad}`
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Net worth over time">
        <polygon points={area} fill="var(--color-accent)" opacity="0.08" />
        <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {history.map((h, i) => (
          <circle key={h.month} cx={x(i)} cy={y(h.net_cents)} r="3" fill="var(--color-accent)" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-slate-400">
        <span>{history[0].month}</span>
        <span>{history[history.length - 1].month}</span>
      </div>
    </div>
  )
}

function BalanceCell({ account, onSaved }: { account: AccountRow; onSaved: () => void }) {
  const [text, setText] = useState(centsToInput(account.balance_cents))
  useEffect(() => setText(centsToInput(account.balance_cents)), [account.balance_cents])
  async function save(): Promise<void> {
    const cents = parseMoney(text || '0')
    if (cents == null || cents === account.balance_cents) {
      setText(centsToInput(account.balance_cents))
      return
    }
    await api.put(`/accounts/${account.id}/balance`, { balance_cents: cents })
    onSaved()
  }
  return (
    <div className="relative w-32">
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

function AddAccountModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { me } = useMe()
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('checking')
  const [owner, setOwner] = useState<string | ''>('')
  const [balance, setBalance] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    try {
      await api.post('/accounts', {
        name: name.trim(),
        type,
        owner_user_id: owner || null,
        balance_cents: balance ?? undefined,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title="Add an account" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Joint checking, Jake's 401(k)…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {(Object.entries(ACCOUNT_TYPE_LABELS) as [AccountType, string][]).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Belongs to">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Joint</option>
              {me.household.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Current balance" hint={LIABILITY_TYPES.includes(type) ? 'Enter what you owe as a positive number.' : undefined}>
          <MoneyInput cents={balance} onCents={setBalance} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!name.trim()}>
            Add account
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function AccountTable({ accounts, onChanged }: { accounts: AccountRow[]; onChanged: () => void }) {
  const { me } = useMe()
  async function archive(account: AccountRow): Promise<void> {
    if (!confirm(`Hide "${account.name}" from net worth? Its history is kept.`)) return
    await api.patch(`/accounts/${account.id}`, { archived: 1 })
    onChanged()
  }
  return (
    <div className="divide-y divide-slate-100">
      {accounts.map((account) => {
        const owner = me.household.members.find((m) => m.id === account.owner_user_id)
        return (
          <div key={account.id} className="group flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <Link to={`/transactions?account=${account.id}`} className="block truncate text-sm font-medium hover:text-violet-700 hover:underline" title="View this account's activity">
                {account.name}
              </Link>
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                {ACCOUNT_TYPE_LABELS[account.type]}
                {owner ? (
                  <span className="inline-flex items-center gap-1">
                    · <Avatar name={owner.name} color={owner.color} size={14} /> {owner.name}
                  </span>
                ) : (
                  <Chip className="!px-1.5 !py-0 text-[10px]">joint</Chip>
                )}
                {account.balance_date && <span>· as of {fmtDate(account.balance_date)}</span>}
              </p>
            </div>
            <button
              onClick={() => void archive(account)}
              title="Archive account"
              className="hidden rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500 group-hover:block"
            >
              <Archive size={13} />
            </button>
            <BalanceCell account={account} onSaved={onChanged} />
          </div>
        )
      })}
      {accounts.length === 0 && <p className="py-3 text-sm text-slate-400">None yet.</p>}
    </div>
  )
}

export default function NetWorth() {
  const { data, reload } = useApi<NetWorthResponse>('/networth')
  const [adding, setAdding] = useState(false)
  if (!data) return null

  const assets = data.accounts.filter((a) => !LIABILITY_TYPES.includes(a.type))
  const liabilities = data.accounts.filter((a) => LIABILITY_TYPES.includes(a.type))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Net worth</h1>
          <p className="text-sm text-slate-500">The whole picture — accounts, investments, and what you owe.</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={15} /> Account
        </Button>
      </div>

      {data.accounts.length === 0 ? (
        <EmptyState emoji="📈" title="Add your accounts to see the full picture">
          Checking, savings, 401(k)s, the car loan — update balances whenever; the trend builds itself.
        </EmptyState>
      ) : (
        <>
          <Card>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="col-span-2 sm:col-span-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Net worth</p>
                <p className="text-2xl font-bold tabular-nums">{fmtMoney(data.net_cents)}</p>
                {data.delta_month_cents != null && (
                  <p className={cls('text-xs font-medium tabular-nums', data.delta_month_cents >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {data.delta_month_cents >= 0 ? '▲' : '▼'} {fmtMoney(Math.abs(data.delta_month_cents))} this month
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Assets</p>
                <p className="text-lg font-bold tabular-nums text-emerald-600 sm:text-2xl">{fmtMoney(data.assets_cents)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Owed</p>
                <p className="text-lg font-bold tabular-nums text-red-500 sm:text-2xl">{fmtMoney(data.liabilities_cents)}</p>
              </div>
            </div>
            <div className="mt-4">
              <NetWorthChart history={data.history} />
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardTitle>Assets</CardTitle>
              <AccountTable accounts={assets} onChanged={reload} />
            </Card>
            <Card>
              <CardTitle>Debts</CardTitle>
              <AccountTable accounts={liabilities} onChanged={reload} />
            </Card>
          </div>
          <p className="text-xs text-slate-400">
            Tip: type a new balance and tab away — each save becomes a dated snapshot, which is what draws the trend
            line. Bank sync (SimpleFIN) will do this automatically later.
          </p>
        </>
      )}

      {adding && (
        <AddAccountModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            reload()
          }}
        />
      )}
    </div>
  )
}
