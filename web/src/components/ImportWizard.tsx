import { useMemo, useState } from 'react'
import type { Category, ImportRule, Split } from '@fold/shared'
import { splitByWeights, splitEqual } from '@fold/shared'
import { Upload, Zap } from 'lucide-react'
import { api } from '../api'
import { useMe } from '../App'
import { fmtMoney } from '../format'
import { Button, ErrorNote, Field, Modal, Select, cls } from '../ui'
import { PayerPicker } from './TxModal'
import { guessColumn, parseCsv, parseCsvAmount, parseCsvDate } from './csv'

type RowMode = 'none' | 'equal' | 'income' | 'owed'

interface ParsedRow {
  include: boolean
  date: string
  description: string
  amount_cents: number
  category_id: string | ''
  mode: RowMode
  ruleApplied: boolean
}

function computeRowSplits(amount: number, mode: RowMode, payerId: string, members: { id: string; monthly_income_cents: number }[]): Split[] {
  switch (mode) {
    case 'none':
      return [{ user_id: payerId, share_cents: amount }]
    case 'equal':
      return splitEqual(amount, members.map((m) => m.id))
    case 'income':
      return splitByWeights(amount, members.map((m) => ({ user_id: m.id, weight: m.monthly_income_cents })))
    case 'owed': {
      const others = members.filter((m) => m.id !== payerId)
      return others.length > 0 ? splitEqual(amount, others.map((m) => m.id)) : [{ user_id: payerId, share_cents: amount }]
    }
  }
}

export default function ImportWizard({
  categories,
  rules,
  onClose,
  onDone,
  onRulesChanged,
}: {
  categories: Category[]
  rules: ImportRule[]
  onClose: () => void
  onDone: (result: { imported: number; skipped: number }) => void
  onRulesChanged: () => void
}) {
  const { me } = useMe()
  const members = me.household.members
  const [step, setStep] = useState<'file' | 'map' | 'review'>('file')
  const [grid, setGrid] = useState<string[][]>([])
  const [fileName, setFileName] = useState('')
  const [dateCol, setDateCol] = useState(0)
  const [descCol, setDescCol] = useState(1)
  const [amountCol, setAmountCol] = useState(2)
  const [hasHeader, setHasHeader] = useState(true)
  const [negativeIsSpending, setNegativeIsSpending] = useState(true)
  const [payerId, setPayerId] = useState(me.user.id)
  const [defaultMode, setDefaultMode] = useState<RowMode>(members.length > 1 ? 'equal' : 'none')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function readFile(file: File): Promise<void> {
    const text = await file.text()
    const parsed = parseCsv(text)
    if (parsed.length === 0) {
      setError('That file looks empty.')
      return
    }
    setFileName(file.name)
    setGrid(parsed)
    const headers = parsed[0]
    setDateCol(Math.max(0, guessColumn(headers, ['date'])))
    setDescCol(Math.max(0, guessColumn(headers, ['description', 'merchant', 'name', 'payee'])))
    setAmountCol(Math.max(0, guessColumn(headers, ['amount', 'debit'])))
    setHasHeader(guessColumn(headers, ['date', 'amount', 'description']) !== -1)
    setError(null)
    setStep('map')
  }

  function buildRows(): void {
    const dataRows = hasHeader ? grid.slice(1) : grid
    const parsed: ParsedRow[] = []
    for (const raw of dataRows) {
      const date = parseCsvDate(raw[dateCol] ?? '')
      const signed = parseCsvAmount(raw[amountCol] ?? '')
      const description = (raw[descCol] ?? '').trim()
      if (!date || signed == null || signed === 0 || !description) continue
      const isSpending = negativeIsSpending ? signed < 0 : signed > 0
      if (!isSpending) continue
      const amount = Math.abs(signed)
      const rule = rules.find((r) => description.toLowerCase().includes(r.match_text.toLowerCase()))
      parsed.push({
        include: true,
        date,
        description,
        amount_cents: amount,
        category_id: rule?.category_id ?? '',
        mode: (rule?.split_mode as RowMode | undefined) ?? defaultMode,
        ruleApplied: !!rule,
      })
    }
    setRows(parsed)
    setError(parsed.length === 0 ? 'No spending rows found with that mapping — check the columns and sign convention.' : null)
    if (parsed.length > 0) setStep('review')
  }

  async function saveRule(row: ParsedRow): Promise<void> {
    const suggestion = row.description.split(/\s{2,}|#|\d{3,}/)[0].trim().slice(0, 40) || row.description.slice(0, 40)
    const match = prompt('Auto-apply when a description contains:', suggestion.toLowerCase())
    if (!match) return
    await api.post('/import-rules', {
      match_text: match,
      category_id: row.category_id || null,
      split_mode: row.mode,
    })
    onRulesChanged()
    setRows((prev) =>
      prev.map((r) =>
        r.description.toLowerCase().includes(match.toLowerCase())
          ? { ...r, category_id: row.category_id, mode: row.mode, ruleApplied: true }
          : r,
      ),
    )
  }

  async function runImport(): Promise<void> {
    const selected = rows.filter((r) => r.include)
    if (selected.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.post<{ imported: number; skipped: number }>('/transactions/import', {
        payer_user_id: payerId,
        rows: selected.map((r) => ({
          date: r.date,
          description: r.description,
          amount_cents: r.amount_cents,
          category_id: r.category_id || null,
          splits: computeRowSplits(r.amount_cents, r.mode, payerId, members),
        })),
      })
      onDone(result)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const includedTotal = useMemo(
    () => rows.filter((r) => r.include).reduce((sum, r) => sum + r.amount_cents, 0),
    [rows],
  )
  const sampleRow = grid[hasHeader ? 1 : 0] ?? []
  const columns = (grid[0] ?? []).map((header, index) => ({
    index,
    label: hasHeader ? header || `Column ${index + 1}` : `Column ${index + 1}`,
  }))

  return (
    <Modal title="Import a bank statement" onClose={onClose} wide>
      {step === 'file' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Export a CSV from your bank or card and drop it here. You'll map the columns, The Fold skips anything
            already imported, and your saved rules pre-fill categories and splits.
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 px-6 py-10 text-slate-500 hover:border-violet-400 hover:text-violet-600">
            <Upload size={28} />
            <span className="text-sm font-medium">Choose a CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void readFile(file)
              }}
            />
          </label>
          <ErrorNote message={error} />
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            <strong>{fileName}</strong> — {grid.length - (hasHeader ? 1 : 0)} rows. Tell The Fold which column is which:
          </p>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                ['Date', dateCol, setDateCol],
                ['Description', descCol, setDescCol],
                ['Amount', amountCol, setAmountCol],
              ] as [string, number, (n: number) => void][]
            ).map(([label, value, setter]) => (
              <Field key={label} label={label}>
                <Select value={value} onChange={(e) => setter(Number(e.target.value))}>
                  {columns.map((c) => (
                    <option key={c.index} value={c.index}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <span className="mt-1 block truncate text-xs text-slate-400">e.g. “{sampleRow[value] ?? ''}”</span>
              </Field>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sign convention">
              <Select
                value={negativeIsSpending ? 'neg' : 'pos'}
                onChange={(e) => setNegativeIsSpending(e.target.value === 'neg')}
              >
                <option value="neg">Spending is negative (most banks)</option>
                <option value="pos">Spending is positive (most credit cards)</option>
              </Select>
            </Field>
            <Field label="Default split for this batch">
              <Select value={defaultMode} onChange={(e) => setDefaultMode(e.target.value as RowMode)}>
                <option value="equal">50 / 50</option>
                <option value="income">By income</option>
                <option value="none">No split (payer's own)</option>
                <option value="owed">Other person owes it all</option>
              </Select>
            </Field>
          </div>
          <Field label="Whose statement is this? (who paid)">
            <PayerPicker value={payerId} onChange={setPayerId} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-violet-600"
            />
            First row is a header
          </label>
          <ErrorNote message={error} />
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep('file')}>
              Back
            </Button>
            <Button onClick={buildRows}>Preview rows</Button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {rows.filter((r) => r.include).length} of {rows.length} rows selected · {fmtMoney(includedTotal)} total ·
            payer: <strong>{members.find((m) => m.id === payerId)?.name}</strong>. Duplicates are skipped automatically.
          </p>
          <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2">Category</th>
                  <th className="px-2 py-2">Split</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, index) => (
                  <tr key={index} className={cls(!row.include && 'opacity-40')}>
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={row.include}
                        onChange={(e) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, include: e.target.checked } : r)))}
                        className="h-4 w-4 rounded border-slate-300 text-violet-600"
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-500">{row.date}</td>
                    <td className="max-w-[180px] truncate px-2 py-1.5" title={row.description}>
                      {row.description}
                      {row.ruleApplied && <Zap size={11} className="ml-1 inline text-amber-500" />}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(row.amount_cents)}</td>
                    <td className="px-2 py-1.5">
                      <select
                        value={row.category_id}
                        onChange={(e) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, category_id: e.target.value } : r)))}
                        className="w-32 rounded-lg border border-slate-200 px-1.5 py-1 text-xs"
                      >
                        <option value="">—</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.emoji ? `${c.emoji} ` : ''}
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={row.mode}
                        onChange={(e) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, mode: e.target.value as RowMode } : r)))}
                        className="rounded-lg border border-slate-200 px-1.5 py-1 text-xs"
                      >
                        <option value="equal">50/50</option>
                        <option value="income">income</option>
                        <option value="none">mine</option>
                        <option value="owed">owed</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => void saveRule(row)}
                        title="Save as auto-rule"
                        className="rounded p-1 text-slate-300 hover:bg-amber-50 hover:text-amber-600"
                      >
                        <Zap size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ErrorNote message={error} />
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep('map')}>
              Back
            </Button>
            <Button onClick={() => void runImport()} disabled={busy || rows.every((r) => !r.include)}>
              {busy ? 'Importing…' : `Import ${rows.filter((r) => r.include).length} transactions`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
