import { useEffect, useRef, useState } from 'react'
import type { BudgetCategoryRow, BudgetGroupRow } from '@fold/shared'
import { ChevronDown, ChevronRight, ChevronUp, RotateCw, Target } from 'lucide-react'
import { centsToInput, fmtMoney, parseMoney } from '../../format'
import { cls, inputCls } from '../../ui'

/** Money input that saves on blur/Enter and jumps to the next envelope on Enter. */
export function AllocationInput({
  cents,
  onSave,
  ariaLabel,
}: {
  cents: number
  onSave: (cents: number) => void
  ariaLabel: string
}) {
  const [text, setText] = useState(centsToInput(cents))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => setText(centsToInput(cents)), [cents])

  function commit(): void {
    const parsed = parseMoney(text || '0')
    if (parsed == null || parsed === cents) {
      setText(centsToInput(cents))
      return
    }
    onSave(parsed)
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-1.5 flex items-center text-xs text-slate-400 sm:left-2">$</span>
      <input
        ref={ref}
        value={text}
        aria-label={ariaLabel}
        inputMode="decimal"
        data-alloc-input
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
            const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-alloc-input]'))
            const next = inputs[inputs.indexOf(e.currentTarget) + 1]
            next ? next.focus() : e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setText(centsToInput(cents))
            e.currentTarget.blur()
          }
        }}
        className={cls(inputCls, 'py-1.5 pl-4 pr-1.5 text-right text-sm tabular-nums sm:pl-5 sm:pr-2')}
      />
    </div>
  )
}

export function TargetChip({ row }: { row: BudgetCategoryRow }) {
  if (row.target_type === 'none' || row.target_cents == null) return null
  const suggestion = row.target_suggestion_cents ?? 0
  const met = row.allocated_cents >= suggestion
  const label =
    row.target_type === 'monthly'
      ? `${fmtMoney(row.target_cents, { whole: true })}/mo`
      : `${fmtMoney(row.target_cents, { whole: true })} by ${row.target_date?.slice(0, 7).replace(/^\d{4}-/, '') ?? ''}`
  const title = met ? 'On track this month' : `Budget ${fmtMoney(suggestion)} this month to stay on track`
  return (
    <>
      {/* Phones get just the colored target icon — the full chip doesn't fit next to the name. */}
      <span title={title} className={cls('shrink-0 sm:hidden', met ? 'text-emerald-500' : 'text-amber-500')}>
        <Target size={11} />
      </span>
      <span
        title={title}
        className={cls(
          'hidden shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex',
          met ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
        )}
      >
        <Target size={9} />
        {label}
      </span>
    </>
  )
}

export function AvailablePill({ row }: { row: BudgetCategoryRow }) {
  const value = row.available_cents
  return (
    <span
      className={cls(
        'inline-block rounded-lg px-1.5 py-1 text-sm font-semibold tabular-nums sm:px-2',
        value < 0
          ? 'bg-red-50 text-red-600'
          : value === 0
            ? 'text-slate-400'
            : 'bg-emerald-50 text-emerald-700',
      )}
    >
      {fmtMoney(value)}
    </span>
  )
}

export function CategoryRow({
  row,
  accent,
  onAllocate,
  onOpen,
  onCover,
  onMoveUp,
  onMoveDown,
}: {
  row: BudgetCategoryRow
  accent: string
  onAllocate: (cents: number) => void
  onOpen: () => void
  onCover: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  const funded = row.allocated_cents + row.carryover_cents
  const pct = funded > 0 ? Math.min(100, (row.spent_cents / funded) * 100) : row.spent_cents > 0 ? 100 : 0
  const overspent = row.available_cents < 0
  const barColor = overspent ? '#ef4444' : pct > 85 ? '#f59e0b' : accent

  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_5.5rem_5rem] items-center gap-x-1.5 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_7rem] sm:gap-x-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {(onMoveUp || onMoveDown) && (
            <span className="-my-1 mr-0.5 hidden shrink-0 flex-col opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:flex">
              <button
                aria-label={`Move ${row.name} up`}
                disabled={!onMoveUp}
                onClick={onMoveUp}
                className="text-slate-300 hover:text-slate-600 disabled:invisible"
              >
                <ChevronUp size={11} />
              </button>
              <button
                aria-label={`Move ${row.name} down`}
                disabled={!onMoveDown}
                onClick={onMoveDown}
                className="text-slate-300 hover:text-slate-600 disabled:invisible"
              >
                <ChevronDown size={11} />
              </button>
            </span>
          )}
          <button onClick={onOpen} className="truncate text-sm font-medium hover:text-violet-700 hover:underline">
            {row.name}
          </button>
          {row.rollover === 1 && (
            <span title="Leftover rolls into next month" className="shrink-0 text-slate-300">
              <RotateCw size={11} />
            </span>
          )}
          <TargetChip row={row} />
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${barColor} 78%, white), ${barColor})` }}
            />
          </div>
          {row.carryover_cents !== 0 && (
            <span
              className={cls('shrink-0 text-[10px] tabular-nums', row.carryover_cents < 0 ? 'text-red-500' : 'text-slate-400')}
              title="Carried over from last month"
            >
              ↩ {fmtMoney(row.carryover_cents)}
            </span>
          )}
        </div>
      </div>

      <AllocationInput cents={row.allocated_cents} onSave={onAllocate} ariaLabel={`Budget for ${row.name}`} />

      <div className="hidden text-right text-sm tabular-nums text-slate-500 sm:block">{fmtMoney(row.spent_cents)}</div>

      <div className="text-right">
        {overspent ? (
          <button onClick={onCover} title="Cover this overspending from another envelope" className="group">
            <AvailablePill row={row} />
            <span className="block text-[10px] font-medium text-red-500 group-hover:underline">cover →</span>
          </button>
        ) : (
          <AvailablePill row={row} />
        )}
      </div>
    </div>
  )
}

export function GroupSection({
  group,
  children,
  collapsed,
  onToggle,
}: {
  group: BudgetGroupRow
  children: React.ReactNode
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <button
        onClick={onToggle}
        className="grid w-full grid-cols-[minmax(0,1fr)_5.5rem_5rem] items-center gap-x-1.5 py-2 text-left hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_7rem] sm:gap-x-3"
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          {collapsed ? <ChevronRight size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
          {group.name}
        </span>
        <span className="text-right text-xs font-medium tabular-nums text-slate-500">
          {fmtMoney(group.allocated_cents)}
        </span>
        <span className="hidden text-right text-xs tabular-nums text-slate-400 sm:block">
          {fmtMoney(group.spent_cents)}
        </span>
        <span
          className={cls(
            'text-right text-xs font-semibold tabular-nums',
            group.available_cents < 0 ? 'text-red-600' : 'text-slate-500',
          )}
        >
          {fmtMoney(group.available_cents)}
        </span>
      </button>
      {!collapsed && <div className="pb-1 pl-1.5 sm:pl-5">{children}</div>}
    </div>
  )
}

export function TableHeader() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5rem] gap-x-1.5 border-b border-slate-200 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_7rem] sm:gap-x-3">
      <span>Category</span>
      <span className="text-right">Budgeted</span>
      <span className="hidden text-right sm:block">Spent</span>
      <span className="text-right">Available</span>
    </div>
  )
}
