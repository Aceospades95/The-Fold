import { useMemo, useState } from 'react'
import type { BalancesResponse, Category, ImportRule, Tx } from '@fold/shared'
import { ArrowLeftRight, ChevronLeft, ChevronRight, Plus, Repeat, Upload } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { currentMonth, fmtDateFull, fmtMoney, fmtMonth, shiftMonth, todayStr } from '../format'
import { Avatar, Button, Card, Chip, EmptyState, ErrorNote, Field, Modal, MoneyInput, TextInput } from '../ui'
import ImportWizard from '../components/ImportWizard'
import RecurringModal from '../components/RecurringModal'
import TxModal from '../components/TxModal'

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

export default function Transactions() {
  const { me } = useMe()
  const [month, setMonth] = useState(currentMonth())
  const transactions = useApi<{ transactions: Tx[] }>(`/transactions?month=${month}`)
  const balances = useApi<BalancesResponse>('/balances')
  const categoriesQuery = useApi<{ categories: Category[] }>('/categories')
  const rulesQuery = useApi<{ rules: ImportRule[] }>('/import-rules')
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
        <Card className="flex items-center justify-between bg-emerald-50/70 !py-3">
          <p className="text-sm text-emerald-800">{importNote}</p>
          <button onClick={() => setImportNote(null)} className="text-xs text-emerald-700 hover:underline">
            dismiss
          </button>
        </Card>
      )}

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

      {grouped.length === 0 && !transactions.loading ? (
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
                  const category = tx.category_id ? categoryById.get(tx.category_id) : null
                  const isSettlement = tx.kind === 'settlement'
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
                        <p className="text-xs text-slate-500">
                          {category ? `${category.emoji ?? ''} ${category.name}` : isSettlement ? 'Settle up' : 'Uncategorized'}
                        </p>
                      </div>
                      {splitLabel && <Chip>{splitLabel}</Chip>}
                      {tx.recurring_id && (
                        <Chip className="bg-violet-100 text-violet-700">
                          <Repeat size={10} /> auto
                        </Chip>
                      )}
                      {tx.trip_expense_id && <Chip className="bg-sky-100 text-sky-700">trip</Chip>}
                      <span className="text-sm font-semibold tabular-nums">{fmtMoney(tx.amount_cents)}</span>
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
