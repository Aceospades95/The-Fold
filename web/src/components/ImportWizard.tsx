import { useEffect, useMemo, useState } from 'react'
import type { Category, ImportBatch, ImportProfile, ImportRule, NetWorthResponse, Split } from '@fold/shared'
import { splitByWeights, splitEqual } from '@fold/shared'
import { Landmark, Undo2, Upload, Zap } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { fmtDate, fmtMoney } from '../format'
import { Button, Chip, ErrorNote, Field, Modal, Select, cls } from '../ui'
import { PayerPicker } from './TxModal'
import { guessColumn, parseCsv, parseCsvAmount, parseCsvDate } from './csv'
import { looksLikeOfx, parseOfx } from './ofx'

type RowMode = 'none' | 'equal' | 'income' | 'owed'

interface ParsedRow {
  include: boolean
  date: string
  /** Positive = spending, negative = credit/refund. */
  amount_cents: number
  description: string
  external_id: string | null
  category_id: string | ''
  mode: RowMode
  ruleApplied: boolean
}

function computeRowSplits(
  amount: number,
  mode: RowMode,
  payerId: string,
  members: { id: string; monthly_income_cents: number }[],
): Split[] {
  const magnitude = Math.abs(amount)
  const sign = Math.sign(amount)
  let shares: Split[]
  switch (mode) {
    case 'none':
      shares = [{ user_id: payerId, share_cents: magnitude }]
      break
    case 'equal':
      shares = splitEqual(magnitude, members.map((m) => m.id))
      break
    case 'income':
      shares = splitByWeights(magnitude, members.map((m) => ({ user_id: m.id, weight: m.monthly_income_cents })))
      break
    case 'owed': {
      const others = members.filter((m) => m.id !== payerId)
      shares = others.length > 0 ? splitEqual(magnitude, others.map((m) => m.id)) : [{ user_id: payerId, share_cents: magnitude }]
      break
    }
  }
  return shares.map((s) => ({ ...s, share_cents: s.share_cents * sign }))
}

const DEFAULT_PROFILE: ImportProfile = {
  date_col: 0,
  desc_col: 1,
  amount_col: 2,
  has_header: true,
  negative_is_spending: true,
  payer_user_id: null,
  default_mode: 'equal',
  include_credits: true,
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
  const networth = useApi<NetWorthResponse>('/networth')
  const profiles = useApi<{ profiles: Record<string, ImportProfile> }>('/import-profiles')
  const batches = useApi<{ batches: ImportBatch[] }>('/import-batches')

  const [step, setStep] = useState<'source' | 'map' | 'review'>('source')
  const [accountId, setAccountId] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileKind, setFileKind] = useState<'csv' | 'ofx'>('csv')
  const [grid, setGrid] = useState<string[][]>([])
  const [ofxBalance, setOfxBalance] = useState<{ amount_cents: number; date: string } | null>(null)
  const [ofxRows, setOfxRows] = useState<{ date: string; description: string; amount_cents: number; external_id: string | null }[]>([])
  const [updateBalance, setUpdateBalance] = useState(true)

  const [dateCol, setDateCol] = useState(0)
  const [descCol, setDescCol] = useState(1)
  const [amountCol, setAmountCol] = useState(2)
  const [hasHeader, setHasHeader] = useState(true)
  const [negativeIsSpending, setNegativeIsSpending] = useState(true)
  const [includeCredits, setIncludeCredits] = useState(true)
  const [payerId, setPayerId] = useState(me.user.id)
  const [defaultMode, setDefaultMode] = useState<RowMode>(members.length > 1 ? 'equal' : 'none')

  const [rows, setRows] = useState<ParsedRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const accounts = networth.data?.accounts ?? []

  function applyProfile(key: string): void {
    const profile = profiles.data?.profiles[key]
    if (!profile) return
    setDateCol(profile.date_col)
    setDescCol(profile.desc_col)
    setAmountCol(profile.amount_col)
    setHasHeader(profile.has_header)
    setNegativeIsSpending(profile.negative_is_spending)
    setIncludeCredits(profile.include_credits)
    setDefaultMode(profile.default_mode)
    if (profile.payer_user_id && members.some((m) => m.id === profile.payer_user_id)) {
      setPayerId(profile.payer_user_id)
    }
  }

  function pickAccount(next: string): void {
    setAccountId(next)
    applyProfile(next || 'default')
  }

  async function readFile(file: File): Promise<void> {
    const text = await file.text()
    setFileName(file.name)
    setError(null)
    if (looksLikeOfx(text)) {
      const statement = parseOfx(text)
      if (statement.rows.length === 0) {
        setError('No transactions found in that OFX file.')
        return
      }
      setFileKind('ofx')
      setOfxRows(statement.rows)
      setOfxBalance(statement.balance)
      buildRows(statement.rows, includeCredits)
      setStep('review')
      return
    }
    const parsed = parseCsv(text)
    if (parsed.length === 0) {
      setError('That file looks empty.')
      return
    }
    setFileKind('csv')
    setGrid(parsed)
    const headers = parsed[0]
    const savedProfile = profiles.data?.profiles[accountId || 'default']
    if (!savedProfile) {
      setDateCol(Math.max(0, guessColumn(headers, ['date'])))
      setDescCol(Math.max(0, guessColumn(headers, ['description', 'merchant', 'name', 'payee'])))
      setAmountCol(Math.max(0, guessColumn(headers, ['amount', 'debit'])))
      setHasHeader(guessColumn(headers, ['date', 'amount', 'description']) !== -1)
    }
    setStep('map')
  }

  function decorate(
    raw: { date: string; description: string; amount_cents: number; external_id: string | null }[],
    withCredits: boolean,
  ): ParsedRow[] {
    return raw
      .filter((row) => row.amount_cents > 0 || withCredits)
      .map((row) => {
        const rule = rules.find((r) => row.description.toLowerCase().includes(r.match_text.toLowerCase()))
        return {
          include: true,
          date: row.date,
          description: row.description,
          amount_cents: row.amount_cents,
          external_id: row.external_id,
          category_id: rule?.category_id ?? '',
          mode: (rule?.split_mode as RowMode | undefined) ?? defaultMode,
          ruleApplied: !!rule,
        }
      })
  }

  function buildRows(
    source?: { date: string; description: string; amount_cents: number; external_id: string | null }[],
    withCredits = includeCredits,
  ): void {
    if (source || fileKind === 'ofx') {
      setRows(decorate(source ?? ofxRows, withCredits))
      return
    }
    const dataRows = hasHeader ? grid.slice(1) : grid
    const raw: { date: string; description: string; amount_cents: number; external_id: string | null }[] = []
    for (const line of dataRows) {
      const date = parseCsvDate(line[dateCol] ?? '')
      const signed = parseCsvAmount(line[amountCol] ?? '')
      const description = (line[descCol] ?? '').trim()
      if (!date || signed == null || signed === 0 || !description) continue
      // Normalize to The Fold's convention: positive = spending.
      raw.push({ date, description, amount_cents: negativeIsSpending ? -signed : signed, external_id: null })
    }
    const parsed = decorate(raw, withCredits)
    setRows(parsed)
    setError(parsed.length === 0 ? 'No usable rows found with that mapping — check the columns and sign convention.' : null)
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

  async function undoBatch(batch: ImportBatch): Promise<void> {
    if (!confirm(`Undo this import? ${batch.imported_count} transactions will be deleted.`)) return
    await api.delete(`/import-batches/${batch.id}`)
    batches.reload()
    onDone({ imported: 0, skipped: 0 })
  }

  async function runImport(): Promise<void> {
    const selected = rows.filter((r) => r.include)
    if (selected.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.post<{ imported: number; skipped: number }>('/transactions/import', {
        payer_user_id: payerId,
        account_id: accountId || null,
        filename: fileName || null,
        account_balance_cents: fileKind === 'ofx' && accountId && updateBalance && ofxBalance ? ofxBalance.amount_cents : null,
        balance_date: fileKind === 'ofx' && accountId && updateBalance && ofxBalance ? ofxBalance.date : null,
        rows: selected.map((r) => ({
          date: r.date,
          description: r.description,
          amount_cents: r.amount_cents,
          external_id: r.external_id,
          category_id: r.category_id || null,
          splits: computeRowSplits(r.amount_cents, r.mode, payerId, members),
        })),
      })
      await api.put(`/import-profiles/${accountId || 'default'}`, {
        date_col: dateCol,
        desc_col: descCol,
        amount_col: amountCol,
        has_header: hasHeader,
        negative_is_spending: negativeIsSpending,
        payer_user_id: payerId,
        default_mode: defaultMode,
        include_credits: includeCredits,
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
  const creditCount = rows.filter((r) => r.amount_cents < 0).length
  const sampleRow = grid[hasHeader ? 1 : 0] ?? []
  const columns = (grid[0] ?? []).map((header, index) => ({
    index,
    label: hasHeader ? header || `Column ${index + 1}` : `Column ${index + 1}`,
  }))
  const accountName = accounts.find((a) => a.id === accountId)?.name

  return (
    <Modal title="Import a statement" onClose={onClose} wide>
      {step === 'source' && (
        <div className="space-y-4">
          <Field
            label="Where is this statement from?"
            hint="The Fold remembers each account's format, sign convention, and payer — future imports are one click."
          >
            <Select value={accountId} onChange={(e) => pickAccount(e.target.value)}>
              <option value="">No specific account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 px-6 py-8 text-slate-500 hover:border-violet-400 hover:text-violet-600">
            <Upload size={26} />
            <span className="text-sm font-medium">Choose a CSV, OFX, or QFX file</span>
            <span className="text-xs text-slate-400">OFX/QFX skips column mapping entirely — banks label everything for us.</span>
            <input
              type="file"
              accept=".csv,.ofx,.qfx,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void readFile(file)
              }}
            />
          </label>
          <ErrorNote message={error} />

          {(batches.data?.batches ?? []).length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Recent imports</p>
              <ul className="divide-y divide-slate-100">
                {(batches.data?.batches ?? []).slice(0, 5).map((batch) => (
                  <li key={batch.id} className="flex items-center gap-2 py-2 text-sm">
                    <Landmark size={14} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{batch.account_name ?? 'No account'}</span>
                      <span className="text-slate-400"> · {batch.filename ?? 'statement'} · {fmtDate(batch.created_at.slice(0, 10))}</span>
                    </span>
                    <span className="text-xs tabular-nums text-slate-500">
                      {batch.imported_count} txs · {fmtMoney(batch.total_cents)}
                    </span>
                    <button
                      onClick={() => void undoBatch(batch)}
                      title="Undo this import"
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Undo2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            <strong>{fileName}</strong> — {grid.length - (hasHeader ? 1 : 0)} rows
            {accountName ? <> from <strong>{accountName}</strong></> : null}. Map the columns:
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
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-violet-600"
              />
              First row is a header
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={includeCredits}
                onChange={(e) => setIncludeCredits(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-violet-600"
              />
              Include credits & refunds (money back reduces category spending)
            </label>
          </div>
          <ErrorNote message={error} />
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep('source')}>
              Back
            </Button>
            <Button onClick={() => buildRows()}>Preview rows</Button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
            <p>
              {rows.filter((r) => r.include).length} of {rows.length} rows · net {fmtMoney(includedTotal)}
              {accountName ? <> · <strong>{accountName}</strong></> : null} · payer{' '}
              <strong>{members.find((m) => m.id === payerId)?.name}</strong>
              {creditCount > 0 && <> · {creditCount} credit{creditCount === 1 ? '' : 's'}</>}
            </p>
            {fileKind === 'ofx' && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={includeCredits}
                  onChange={(e) => {
                    setIncludeCredits(e.target.checked)
                    buildRows(ofxRows, e.target.checked)
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600"
                />
                include credits
              </label>
            )}
          </div>

          {fileKind === 'ofx' && (
            <Field label="Whose statement is this? (who paid)">
              <PayerPicker value={payerId} onChange={setPayerId} />
            </Field>
          )}

          {fileKind === 'ofx' && ofxBalance && accountId && (
            <label className="flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-800">
              <input
                type="checkbox"
                checked={updateBalance}
                onChange={(e) => setUpdateBalance(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-violet-600"
              />
              Also set {accountName}'s balance to <strong>{fmtMoney(Math.abs(ofxBalance.amount_cents))}</strong> (statement
              balance as of {fmtDate(ofxBalance.date)})
            </label>
          )}

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
                    <td
                      className={cls(
                        'px-2 py-1.5 text-right tabular-nums',
                        row.amount_cents < 0 && 'font-medium text-emerald-600',
                      )}
                    >
                      {row.amount_cents < 0 ? `+${fmtMoney(-row.amount_cents)}` : fmtMoney(row.amount_cents)}
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={row.category_id}
                        onChange={(e) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, category_id: e.target.value } : r)))}
                        className="w-32 rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-xs"
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
                        className="rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-xs"
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
            <Button variant="secondary" onClick={() => setStep(fileKind === 'csv' ? 'map' : 'source')}>
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
