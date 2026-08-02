import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { BalancesResponse, Category, ImportRule, NetWorthResponse, Tx } from '@fold/shared'
import { ArrowLeftRight, ChevronLeft, ChevronRight, Plus, Repeat, Search, Split as SplitIcon, Tag, Upload, X } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { currentMonth, fmtDate, fmtDateFull, fmtMoney, fmtMonth, shiftMonth, todayStr } from '../format'
import { Avatar, Button, Card, Chip, EmptyState, ErrorNote, Field, Modal, MoneyInput, TextInput, cls } from '../ui'
import ImportWizard from '../components/ImportWizard'
import RecurringModal from '../components/RecurringModal'
import TxModal, { CategorySelect } from '../components/TxModal'

function SettleModal({ balances, onClose, onSaved }: { balances: BalancesResponse; onClose: () => void; onSaved: () => void }) {
  const { me } = useMe()
  const members = me.household.members
  const suggestion = balances.suggestion
  const [fromId, setFromId] = useState(suggestion?.from_user_id ?? members[0]?.id ?? '')
  const [amount, setAmount] = useState<number | null>(suggestion?.amount_cents ?? null)
  const [date, setDate] = useState(todayStr())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toId = members.find((m) => m.id !== fromId)?.id ?? ''

  async function save(): Promise<void> {
    if (!amount || !toId) return
    setBusy(true)
    try {
      await api.post('/settle', { from_user_id: fromId, to_user_id: toId, amount_cents: amount, date })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const from = members.find((m) => m.id === fromId)
  const to = members.find((m) => m.id === toId)
  return (
    <Modal title="Record a payment" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Log money one of you actually paid the other (Venmo, cash, whatever) to zero out the running balance.
        </p>
        <Field label="Who paid?">
          <div className="flex gap-2">
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setFromId(m.id)}
                className={
                  fromId === m.id
                    ? 'flex items-center gap-2 rounded-lg border border-violet-600 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700'
                    : 'flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600'
                }
              >
                <Avatar name={m.name} color={m.color} size={22} />
                {m.name}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <MoneyInput cents={amount} onCents={setAmount} />
          </Field>
          <Field label="Date">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {from && to && amount != null && amount > 0 && (
          <p className="text-sm text-slate-600">
            {from.name} → {to.name}: <strong>{fmtMoney(amount)}</strong>
          </p>
        )}
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!amount || busy}>
            Record payment
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Post-import cleanup: assign a category to everything that came in bare. */
function ClassifyQueue({
  transactions,
  categories,
  onDone,
  onSplit,
  onReload,
}: {
  transactions: Tx[]
  categories: Category[]
  onDone: () => void
  onSplit: (tx: Tx) => void
  onReload: () => void
}) {
  const { me } = useMe()
  const [error, setError] = useState<string | null>(null)

  async function assign(tx: Tx, categoryId: string): Promise<void> {
    if (!categoryId) return
    setError(null)
    try {
      await api.patch(`/transactions/${tx.id}/categories`, {
        lines: [{ category_id: categoryId, amount_cents: tx.amount_cents }],
      })
      onReload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Tag size={16} className="text-amber-500" /> Needs a category
          </h2>
          <p className="text-xs text-slate-500">
            {transactions.length === 0
              ? 'All caught up — every transaction is categorized.'
              : `${transactions.length} transaction${transactions.length === 1 ? '' : 's'} won’t show in the budget until you file ${transactions.length === 1 ? 'it' : 'them'}.`}
          </p>
        </div>
        <Button variant="secondary" onClick={onDone}>
          Back to all spending
        </Button>
      </div>
      <ErrorNote message={error} />
      {transactions.length === 0 ? (
        <EmptyState emoji="🎉" title="Nothing left to classify">
          Imported transactions land here whenever they arrive without a category.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {transactions.map((tx) => {
            const payer = me.household.members.find((m) => m.id === tx.payer_user_id)
            return (
              <li key={tx.id} className="flex flex-wrap items-center gap-2 py-2.5">
                {payer && <Avatar name={payer.name} color={payer.color} size={26} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{tx.description}</p>
                  <p className="text-xs text-slate-500">{fmtDate(tx.date)}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums">{fmtMoney(tx.amount_cents)}</span>
                <CategorySelect
                  categories={categories}
                  value=""
                  onChange={(categoryId) => void assign(tx, categoryId)}
                  allowNone
                  className="!w-44"
                />
                <button
                  onClick={() => onSplit(tx)}
                  title="Split this across several categories"
                  className="rounded-lg border border-slate-300 p-1.5 text-slate-500 hover:border-violet-400 hover:text-violet-600"
                >
                  <SplitIcon size={14} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

export default function Transactions() {
  const { me } = useMe()
  const [searchParams, setSearchParams] = useSearchParams()
  const needsCategory = searchParams.get('needs') === 'category'
  const [month, setMonth] = useState(currentMonth())
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterAccount, setFilterAccount] = useState(searchParams.get('account') ?? '')
  const [filterPayer, setFilterPayer] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(timer)
  }, [q])

  const filtering = !!(debouncedQ || filterCategory || filterAccount || filterPayer)
  const txQuery = useMemo(() => {
    const params = new URLSearchParams()
    // A search spans all time; otherwise stay in the picked month.
    if (!filtering) params.set('month', month)
    if (debouncedQ) params.set('q', debouncedQ)
    if (filterCategory) params.set('category', filterCategory)
    if (filterAccount) params.set('account', filterAccount)
    if (filterPayer) params.set('payer', filterPayer)
    return params.toString()
  }, [month, debouncedQ, filterCategory, filterAccount, filterPayer, filtering])
  const transactions = useApi<{ transactions: Tx[] }>(`/transactions?${txQuery}`)
  const balances = useApi<BalancesResponse>('/balances')
  const categoriesQuery = useApi<{ categories: Category[] }>('/categories')
  const networth = useApi<NetWorthResponse>('/networth')
  const rulesQuery = useApi<{ rules: ImportRule[] }>('/import-rules')
  const uncategorizedQuery = useApi<{ transactions: Tx[] }>(needsCategory ? '/transactions?uncategorized=1' : null)
  const [editing, setEditing] = useState<Tx | null>(null)
  const [adding, setAdding] = useState(false)
  const [settling, setSettling] = useState(false)
  const [managingRecurring, setManagingRecurring] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importNote, setImportNote] = useState<string | null>(null)

  const members = me.household.members
  const categories = categoriesQuery.data?.categories ?? []
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const grouped = useMemo(() => {
    const groups: { date: string; txs: Tx[] }[] = []
    for (const tx of transactions.data?.transactions ?? []) {
      const last = groups[groups.length - 1]
      if (last && last.date === tx.date) last.txs.push(tx)
      else groups.push({ date: tx.date, txs: [tx] })
    }
    return groups
  }, [transactions.data])

  function reloadAll(): void {
    transactions.reload()
    balances.reload()
    if (needsCategory) uncategorizedQuery.reload()
  }

  function categoryLabel(tx: Tx): string {
    if (tx.kind === 'settlement') return 'Settle up'
    if (tx.lines.length > 1) {
      const named = tx.lines
        .map((line) => categoryById.get(line.category_id ?? '')?.name)
        .filter((name): name is string => !!name)
      return named.length > 0 ? `${named[0]} + ${tx.lines.length - 1} more` : `${tx.lines.length} categories`
    }
    const category = tx.lines[0]?.category_id ? categoryById.get(tx.lines[0].category_id) : null
    return category ? `${category.emoji ?? ''} ${category.name}`.trim() : 'Uncategorized'
  }

  const suggestion = balances.data?.suggestion
  const creditor = suggestion ? members.find((m) => m.id === suggestion.to_user_id) : null
  const debtor = suggestion ? members.find((m) => m.id === suggestion.from_user_id) : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Spending</h1>
          <p className="text-sm text-slate-500">Every shared and personal expense, split your way.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!needsCategory && (
            <Button variant="secondary" onClick={() => setSearchParams({ needs: 'category' })}>
              <Tag size={15} /> Classify
            </Button>
          )}
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <Upload size={15} /> Import CSV
          </Button>
          <Button variant="secondary" onClick={() => setManagingRecurring(true)}>
            <Repeat size={15} /> Recurring
          </Button>
          <Button variant="secondary" onClick={() => setSettling(true)}>
            <ArrowLeftRight size={15} /> Settle up
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus size={15} /> Add expense
          </Button>
        </div>
      </div>

      {importNote && (
        <Card className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50/70 !py-3">
          <p className="text-sm text-emerald-800">{importNote}</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSearchParams({ needs: 'category' })}
              className="text-xs font-medium text-emerald-800 underline"
            >
              Classify what’s missing →
            </button>
            <button onClick={() => setImportNote(null)} className="text-xs text-emerald-700 hover:underline">
              dismiss
            </button>
          </div>
        </Card>
      )}

      <Card className="space-y-2.5 !py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-44 flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search all spending…"
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-sm placeholder:text-slate-400 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji ? `${c.emoji} ` : ''}
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600"
          >
            <option value="">All accounts</option>
            {(networth.data?.accounts ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <select
            value={filterPayer}
            onChange={(e) => setFilterPayer(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600"
          >
            <option value="">Paid by anyone</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                Paid by {m.name}
              </option>
            ))}
          </select>
          {filtering && (
            <button
              onClick={() => {
                setQ('')
                setFilterCategory('')
                setFilterAccount('')
                setFilterPayer('')
                setSearchParams({})
              }}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
        {filtering && (
          <p className="text-xs text-slate-500">
            Showing {transactions.data?.transactions.length ?? 0} matches across all months.
          </p>
        )}
      </Card>

      <Card className="flex items-center justify-between !py-3">
        {suggestion && creditor && debtor ? (
          <p className="text-sm">
            <Avatar name={debtor.name} color={debtor.color} size={22} />{' '}
            <strong>{debtor.id === me.user.id ? 'You' : debtor.name}</strong> owe{debtor.id === me.user.id ? '' : 's'}{' '}
            <strong>{creditor.id === me.user.id ? 'you' : creditor.name}</strong>{' '}
            <strong className="tabular-nums">{fmtMoney(suggestion.amount_cents)}</strong>
          </p>
        ) : (
          <p className="text-sm text-slate-600">✨ All settled — nobody owes anybody.</p>
        )}
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <ChevronLeft size={17} />
          </button>
          <span className="w-32 text-center text-sm font-semibold">{fmtMonth(month)}</span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <ChevronRight size={17} />
          </button>
        </div>
      </Card>

      {needsCategory ? (
        <ClassifyQueue
          transactions={uncategorizedQuery.data?.transactions ?? []}
          categories={categories}
          onDone={() => setSearchParams({})}
          onSplit={(tx) => setEditing(tx)}
          onReload={reloadAll}
        />
      ) : grouped.length === 0 && !transactions.loading ? (
        <EmptyState emoji="🧾" title={`Nothing recorded for ${fmtMonth(month)}`}>
          Add an expense and choose how to split it.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.date}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{fmtDateFull(group.date)}</p>
              <Card className="divide-y divide-slate-100 !p-0">
                {group.txs.map((tx) => {
                  const payer = members.find((m) => m.id === tx.payer_user_id)
                  const isSettlement = tx.kind === 'settlement'
                  const uncategorized = !isSettlement && tx.lines.some((line) => !line.category_id)
                  const splitLabel = isSettlement
                    ? 'payment'
                    : tx.splits.length > 1
                      ? 'split'
                      : tx.splits[0]?.user_id === tx.payer_user_id
                        ? null
                        : 'owed'
                  return (
                    <button
                      key={tx.id}
                      onClick={() => !isSettlement && setEditing(tx)}
                      disabled={isSettlement}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-white"
                    >
                      {payer && <Avatar name={payer.name} color={payer.color} size={30} />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {isSettlement ? '💸 ' : ''}
                          {tx.description}
                        </p>
                        <p className={cls('text-xs', uncategorized ? 'font-medium text-amber-600' : 'text-slate-500')}>
                          {categoryLabel(tx)}
                        </p>
                      </div>
                      {tx.lines.length > 1 && (
                        <Chip className="bg-slate-100 text-slate-600">
                          <SplitIcon size={10} /> {tx.lines.length}
                        </Chip>
                      )}
                      {splitLabel && <Chip>{splitLabel}</Chip>}
                      {tx.recurring_id && (
                        <Chip className="bg-violet-100 text-violet-700">
                          <Repeat size={10} /> auto
                        </Chip>
                      )}
                      {tx.trip_expense_id && <Chip className="bg-sky-100 text-sky-700">trip</Chip>}
                      {tx.amount_cents < 0 && <Chip className="bg-emerald-100 text-emerald-700">refund</Chip>}
                      <span
                        className={cls(
                          'text-sm font-semibold tabular-nums',
                          tx.amount_cents < 0 && 'text-emerald-600',
                        )}
                      >
                        {tx.amount_cents < 0 ? `+${fmtMoney(-tx.amount_cents)}` : fmtMoney(tx.amount_cents)}
                      </span>
                    </button>
                  )
                })}
              </Card>
            </div>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <TxModal
          existing={editing}
          categories={categories}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSaved={() => {
            setAdding(false)
            setEditing(null)
            reloadAll()
          }}
        />
      )}
      {settling && balances.data && (
        <SettleModal
          balances={balances.data}
          onClose={() => setSettling(false)}
          onSaved={() => {
            setSettling(false)
            reloadAll()
          }}
        />
      )}
      {managingRecurring && (
        <RecurringModal
          categories={categories}
          onClose={() => setManagingRecurring(false)}
          onChanged={reloadAll}
        />
      )}
      {importing && (
        <ImportWizard
          categories={categories}
          rules={rulesQuery.data?.rules ?? []}
          onClose={() => setImporting(false)}
          onRulesChanged={rulesQuery.reload}
          onDone={(result) => {
            setImporting(false)
            setImportNote(
              `Imported ${result.imported} transaction${result.imported === 1 ? '' : 's'}` +
                (result.skipped > 0 ? ` — skipped ${result.skipped} already-imported duplicate${result.skipped === 1 ? '' : 's'}.` : '.'),
            )
            reloadAll()
          }}
        />
      )}
    </div>
  )
}
