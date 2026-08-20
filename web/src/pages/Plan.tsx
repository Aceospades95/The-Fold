import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Link } from 'react-router-dom'
import type { PlanAllocKey, PlanDeductionType, PlanMath, PlanPayFreq, PlanPerson, PlanState } from '@fold/shared'
import {
  PLAN_ALLOC_KEYS,
  PLAN_DED_TYPES,
  PLAN_FREQ_FACTOR,
  PLAN_FREQ_LABELS,
  checksInMonth,
  computePlan,
  fairness,
  planAnnualGross,
  planId,
  planMonthGross,
  planPerCheck,
  rebalanceAlloc,
} from '@fold/shared'
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Lock, LockOpen, Plus, RefreshCw, X } from 'lucide-react'
import { api, useApi } from '../api'
import { currentMonth, fmtMoney, fmtMonth, shiftMonth } from '../format'
import { Button, Card, EmptyState, NumberInput, cls } from '../ui'

/* ---------------------------------------------------------------- helpers -- */

const fmt$ = (v: number): string => `${v < 0 ? '−$' : '$'}${Math.abs(Math.round(v)).toLocaleString('en-US')}`

function memberVar(hex: string): string {
  return `var(--member-${hex.replace('#', '').toLowerCase()}, ${hex})`
}

/**
 * Flow colors: the accent family carries the money you keep (pool → living),
 * a cool companion set (sky/indigo/cyan) carries the other buckets, and slate
 * carries money that leaves (taxes, deductions). Accent pieces re-theme.
 */
const FLOW = {
  pool: 'var(--color-violet-500)',
  living: 'var(--color-violet-600)',
  savings: '#38bdf8',
  invest: '#818cf8',
  trip: '#22d3ee',
  pre: '#2dd4bf',
  tax: 'var(--color-slate-400)',
  post: 'var(--color-slate-300)',
}

const ALLOC_META: Record<PlanAllocKey, { label: string; color: string }> = {
  living: { label: 'Shared living', color: FLOW.living },
  savings: { label: 'Savings', color: FLOW.savings },
  invest: { label: 'Investments', color: FLOW.invest },
  trip: { label: 'Trip fund', color: FLOW.trip },
  personal: { label: 'Personal allowances', color: 'var(--color-slate-400)' },
}

interface ActualsResponse {
  month: string
  days_in_month: number
  today_day: number
  shared_total_cents: number
  by_category: { category_id: string; name: string; total_cents: number }[]
  personal: { user_id: string; total_cents: number }[]
}

function SectionTitle({ n, title, hint }: { n: number; title: string; hint?: React.ReactNode }) {
  return (
    <>
      <h2 className="flex items-center gap-2 text-[15px] font-bold">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-violet-700 text-[11px] font-bold text-on-accent">
          {n}
        </span>
        {title}
      </h2>
      {hint && <p className="mb-3 mt-0.5 text-xs text-slate-400">{hint}</p>}
    </>
  )
}

function NumberField({
  label,
  value,
  onChange,
  width = 'w-28',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  width?: string
}) {
  return (
    <label className="mb-2 grid grid-cols-[1fr_auto] items-center gap-2.5 text-xs text-slate-500">
      <span>{label}</span>
      <NumberInput
        value={Number.isFinite(value) ? value : 0}
        onValue={onChange}
        className={cls('rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm tabular-nums', width)}
      />
    </label>
  )
}

function SliderRow({
  label,
  value,
  min = 0,
  max = 20,
  step = 0.5,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="mb-2 grid grid-cols-[1fr_150px_72px] items-center gap-2.5 text-xs text-slate-500">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
        aria-label={label}
      />
      <span className="flex items-center justify-end gap-0.5">
        <NumberInput
          value={Math.round(value * 100) / 100}
          aria-label={`${label} value`}
          onValue={(v) => onChange(Math.min(max, Math.max(min, v)))}
          className="w-12 rounded-md border border-slate-200 bg-white px-1 py-0.5 text-right text-sm font-medium tabular-nums text-slate-700"
        />
        <span className="text-xs text-slate-400">%</span>
      </span>
    </div>
  )
}

/* ----------------------------------------------------------------- sankey -- */

interface SankeyNode {
  id: string
  label: string
  val: number
  color: string
  x?: number
  y?: number
  h?: number
  col?: number
  inY?: number
  outY?: number
}

type FlowView = { kind: 'avg' } | { kind: 'yr' } | { kind: 'month'; month: string }

function PlanSankey({ state, math, view }: { state: PlanState; math: PlanMath; view: FlowView }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null)
  const [a, b] = state.people
  const colorA = memberVar(a.color)
  const colorB = memberVar(b.color)
  const per = view.kind === 'yr' ? '/ yr' : view.kind === 'month' ? `· ${fmtMonth(view.month)}` : '/ mo'

  const { nodes, links } = useMemo(() => {
    const m = math
    // Per-person scale: 1 for an average month, 12 for the year, and for a real
    // month the actual paycheck count — a 3-check month visibly swells.
    const factor = (index: 0 | 1): number => {
      if (view.kind === 'yr') return 12
      if (view.kind === 'avg') return 1
      const avgMo = m.people[index].gross / 12
      return avgMo > 0 ? planMonthGross(state.people[index], view.month) / avgMo : 1
    }
    const FA = factor(0)
    const FB = factor(1)
    const p0 = m.people[0]
    const p1 = m.people[1]
    const grossMo = m.gross / 12 || 1
    const scaled = (v0: number, v1: number): number => (v0 * FA + v1 * FB) / 12

    const pre = scaled(p0.income_exempt, p1.income_exempt)
    const tax = scaled(p0.fica + p0.share_tax, p1.fica + p1.share_tax)
    const post = scaled(p0.post, p1.post)
    const pool = scaled(p0.contrib, p1.contrib)
    const k401 = scaled(p0.k401, p1.k401)
    const health = scaled(p0.health, p1.health)
    const otherPre = Math.max(0, pre - k401 - health)
    const fica = scaled(p0.fica, p1.fica)
    // Federal + state are joint; scale them together by what's left of tax.
    const fedStateF = m.fed + m.state > 0 ? (tax - fica) / ((m.fed + m.state) / 12) : 0
    const fed = (m.fed / 12) * fedStateF
    const st = (m.state / 12) * fedStateF
    const poolF = m.pool > 0 ? pool / (m.pool / 12) : 0

    const col1: SankeyNode[] = [
      { id: 'A', label: a.name, val: (p0.gross / 12) * FA, color: colorA },
      { id: 'B', label: b.name, val: (p1.gross / 12) * FB, color: colorB },
    ]
    const col2: SankeyNode[] = [
      { id: 'PRE', label: 'Pre-tax savings & benefits', val: pre, color: FLOW.pre },
      { id: 'TAX', label: 'Taxes', val: tax, color: FLOW.tax },
      { id: 'POST', label: 'Post-tax deductions', val: post, color: FLOW.post },
      { id: 'POOL', label: 'Take-home pool', val: pool, color: FLOW.pool },
    ]
    const col3: SankeyNode[] = [
      { id: 'K401', label: '401(k) retirement', val: k401, color: FLOW.pre },
      { id: 'HLTH', label: 'Health & benefits', val: health, color: FLOW.pre },
      { id: 'OPRE', label: 'Other pre-tax', val: otherPre, color: FLOW.pre },
      { id: 'FED', label: 'Federal income tax', val: fed, color: FLOW.tax },
      { id: 'FICA', label: 'FICA payroll tax', val: fica, color: FLOW.tax },
      { id: 'ST', label: 'State income tax', val: st, color: FLOW.tax },
      { id: 'PSTD', label: 'Post-tax lines', val: post, color: FLOW.post },
      { id: 'LIV', label: 'Shared living', val: m.alloc.living * poolF, color: FLOW.living },
      { id: 'SAV', label: 'Savings', val: m.alloc.savings * poolF, color: FLOW.savings },
      { id: 'INV', label: 'Investments', val: m.alloc.invest * poolF, color: FLOW.invest },
      { id: 'TRIP', label: 'Trip fund', val: m.alloc.trip * poolF, color: FLOW.trip },
      { id: 'PA', label: `Personal — ${a.name}`, val: m.personal_a * poolF, color: colorA },
      { id: 'PB', label: `Personal — ${b.name}`, val: m.personal_b * poolF, color: colorB },
    ]
    const rawLinks: [string, string, number][] = [
      ['A', 'PRE', (p0.income_exempt / 12) * FA],
      ['A', 'TAX', ((p0.fica + p0.share_tax) / 12) * FA],
      ['A', 'POST', (p0.post / 12) * FA],
      ['A', 'POOL', (p0.contrib / 12) * FA],
      ['B', 'PRE', (p1.income_exempt / 12) * FB],
      ['B', 'TAX', ((p1.fica + p1.share_tax) / 12) * FB],
      ['B', 'POST', (p1.post / 12) * FB],
      ['B', 'POOL', (p1.contrib / 12) * FB],
      ['PRE', 'K401', k401],
      ['PRE', 'HLTH', health],
      ['PRE', 'OPRE', otherPre],
      ['TAX', 'FED', fed],
      ['TAX', 'FICA', fica],
      ['TAX', 'ST', st],
      ['POST', 'PSTD', post],
      ['POOL', 'LIV', m.alloc.living * poolF],
      ['POOL', 'SAV', m.alloc.savings * poolF],
      ['POOL', 'INV', m.alloc.invest * poolF],
      ['POOL', 'TRIP', m.alloc.trip * poolF],
      ['POOL', 'PA', m.personal_a * poolF],
      ['POOL', 'PB', m.personal_b * poolF],
    ]
    const H = 520
    const PADY = 20
    const GAP = 12
    const X = [150, 473, 796]
    const byId: Record<string, SankeyNode> = {}
    ;[col1, col2, col3].forEach((col, ci) => {
      const live = col.filter((n) => n.val > 0.5)
      const total = live.reduce((sum, n) => sum + n.val, 0) || 1
      const scale = (H - 2 * PADY - GAP * (live.length - 1)) / total
      let y = PADY
      for (const n of live) {
        n.x = X[ci]
        n.y = y
        n.h = Math.max(2, n.val * scale)
        n.col = ci
        n.inY = y
        n.outY = y
        byId[n.id] = n
        y += n.h + GAP
      }
    })
    const viewGross = col1.reduce((sum, n) => sum + n.val, 0) || grossMo
    const paths: {
      d: string
      fromColor: string
      toColor: string
      x0: number
      x1: number
      from: string
      to: string
      val: number
      pct: string
    }[] = []
    for (const [fromId, toId, val] of rawLinks) {
      if (val <= 0.5) continue
      const s = byId[fromId]
      const t = byId[toId]
      if (!s || !t) continue
      const sh = val * (s.h! / s.val)
      const th = val * (t.h! / t.val)
      const sy = s.outY!
      const ty = t.inY!
      s.outY! += sh
      t.inY! += th
      const x0 = s.x! + 14
      const x1 = t.x!
      const mx = (x0 + x1) / 2
      paths.push({
        d: `M ${x0} ${sy} C ${mx} ${sy} ${mx} ${ty} ${x1} ${ty} L ${x1} ${ty + th} C ${mx} ${ty + th} ${mx} ${sy + sh} ${x0} ${sy + sh} Z`,
        fromColor: s.color,
        toColor: t.color,
        x0,
        x1,
        from: s.label,
        to: t.label,
        val,
        pct: ((val / viewGross) * 100).toFixed(1),
      })
    }
    return { nodes: Object.values(byId), links: paths }
  }, [state, math, view, a.name, b.name, colorA, colorB])

  function show(e: { clientX: number; clientY: number }, lines: string[]): void {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box) return
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top - 6, lines })
  }

  const viewGross = nodes.filter((n) => n.col === 0).reduce((sum, n) => sum + n.val, 0) || 1
  return (
    <div ref={boxRef} className="relative overflow-x-auto">
      <svg viewBox="0 0 960 520" className="w-full min-w-[640px]" role="img" aria-label="Money flow from incomes through deductions and taxes to budget buckets">
        <defs>
          {links.map((link, i) => (
            <linearGradient key={i} id={`flow-g${i}`} gradientUnits="userSpaceOnUse" x1={link.x0} x2={link.x1} y1="0" y2="0">
              <stop offset="0" style={{ stopColor: link.fromColor }} />
              <stop offset="1" style={{ stopColor: link.toColor }} />
            </linearGradient>
          ))}
        </defs>
        {links.map((link, i) => (
          <path
            key={i}
            d={link.d}
            style={{ fill: `url(#flow-g${i})`, opacity: 0.5 }}
            className="transition-opacity hover:opacity-80"
            onPointerMove={(e) => show(e, [`${fmt$(link.val)} ${per}`, `${link.from} → ${link.to}`, `${link.pct}% of gross`])}
            onPointerLeave={() => setTip(null)}
          />
        ))}
        {nodes.map((n) => {
          const anchorEnd = n.col === 0
          const tx = anchorEnd ? n.x! - 8 : n.x! + 22
          const anchor = anchorEnd ? 'end' : 'start'
          const cy = n.y! + n.h! / 2
          const pct = ((n.val / viewGross) * 100).toFixed(1)
          return (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={14}
                height={n.h}
                rx={3}
                style={{ fill: n.color }}
                tabIndex={0}
                aria-label={`${n.label}: ${fmt$(n.val)} ${per}`}
                onPointerMove={(e) => show(e, [`${fmt$(n.val)} ${per}`, n.label, `${pct}% of gross`])}
                onPointerLeave={() => setTip(null)}
              />
              {n.h! >= 30 ? (
                <>
                  <text x={tx} y={cy - 2} textAnchor={anchor} fontSize="11.5" className="fill-slate-500" style={{ paintOrder: 'stroke', stroke: 'var(--color-white)', strokeWidth: 3, strokeLinejoin: 'round' }}>
                    {n.label}
                  </text>
                  <text x={tx} y={cy + 12} textAnchor={anchor} fontSize="11.5" fontWeight="600" className="fill-slate-800" style={{ paintOrder: 'stroke', stroke: 'var(--color-white)', strokeWidth: 3, strokeLinejoin: 'round' }}>
                    {fmt$(n.val)}
                  </text>
                </>
              ) : (
                <text x={tx} y={cy + 4} textAnchor={anchor} fontSize="11" className="fill-slate-500" style={{ paintOrder: 'stroke', stroke: 'var(--color-white)', strokeWidth: 3, strokeLinejoin: 'round' }}>
                  {n.label} <tspan dx={5} fontWeight="600" className="fill-slate-800">{fmt$(n.val)}</tspan>
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.lines.map((line, i) => (
            <p key={i} className={i === 0 ? 'font-semibold text-slate-800' : 'text-slate-500'}>
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- persons -- */

function PersonPanel({
  person,
  onChange,
}: {
  person: PlanPerson
  onChange: (next: PlanPerson) => void
}) {
  const annual = planAnnualGross(person)
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 p-3.5 pl-4">
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: memberVar(person.color) }} />
      {person.user_id ? (
        <h3 className="mb-2.5 text-sm font-semibold">{person.name}</h3>
      ) : (
        <div className="mb-2.5">
          <input
            value={person.name}
            aria-label="Partner name"
            onChange={(e) => onChange({ ...person, name: e.target.value })}
            className="w-36 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-semibold"
          />
        </div>
      )}
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>Pay</span>
        <span className="inline-flex overflow-hidden rounded-lg border border-slate-200">
          {(['salary', 'hourly'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onChange({ ...person, pay_type: t })}
              className={cls(
                'px-2.5 py-1 text-xs font-medium transition-colors',
                person.pay_type === t ? 'bg-violet-600 text-on-accent' : 'bg-white text-slate-500',
              )}
            >
              {t === 'salary' ? 'Salary' : 'Hourly'}
            </button>
          ))}
        </span>
      </div>
      {person.pay_type === 'salary' ? (
        <div className="mb-2 grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-slate-500">
          <span>Salary (a year)</span>
          <NumberInput
            value={Number.isFinite(person.salary) ? person.salary : 0}
            aria-label="Annual salary"
            onValue={(salary) => onChange({ ...person, salary })}
            className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm tabular-nums"
          />
        </div>
      ) : (
        <>
          <div className="mb-2 grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-slate-500">
            <span>Hourly rate ($)</span>
            <NumberInput
              value={Number.isFinite(person.hourly_rate) ? person.hourly_rate : 0}
              aria-label="Hourly rate"
              onValue={(hourly_rate) => onChange({ ...person, hourly_rate })}
              className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm tabular-nums"
            />
          </div>
          <div className="mb-2 grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-slate-500">
            <span>Hours a week</span>
            <NumberInput
              value={Number.isFinite(person.hours_per_week) ? person.hours_per_week : 0}
              aria-label="Hours per week"
              onValue={(hours_per_week) => onChange({ ...person, hours_per_week })}
              className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm tabular-nums"
            />
          </div>
        </>
      )}
      <div className="mb-2 grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-slate-500">
        <span>Paid</span>
        <select
          value={person.pay_freq}
          aria-label="Pay frequency"
          onChange={(e) => onChange({ ...person, pay_freq: e.target.value as PlanPayFreq })}
          className="rounded-lg border border-slate-200 bg-white px-1.5 py-1.5 text-xs text-slate-600"
        >
          {(Object.keys(PLAN_FREQ_FACTOR) as PlanPayFreq[]).map((freq) => (
            <option key={freq} value={freq}>
              {PLAN_FREQ_LABELS[freq]}
            </option>
          ))}
        </select>
      </div>
      {(person.pay_freq === 'biweekly' || person.pay_freq === 'weekly') && (
        <div className="mb-2 grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-slate-500">
          <span>Next payday</span>
          <input
            type="date"
            value={person.next_payday ?? ''}
            aria-label={`${person.name} next payday`}
            onChange={(e) => onChange({ ...person, next_payday: e.target.value || null })}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
          />
        </div>
      )}
      <p className="-mt-1 mb-2 text-right text-[10px] tabular-nums text-slate-400">
        {person.pay_type === 'hourly' && annual > 0 ? `= ${fmt$(annual)} a year · ` : ''}
        {annual > 0 ? `≈ ${fmt$(planPerCheck(person))} gross per paycheck` : 'Enter pay to see paycheck math'}
      </p>
      {person.k401_pct > 0 && (
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <SliderRow
              label="401(k) — % of gross, pre-tax"
              value={person.k401_pct}
              onChange={(k401_pct) => onChange({ ...person, k401_pct })}
            />
          </div>
          <button
            title="Remove 401(k)"
            aria-label={`Remove ${person.name}'s 401(k)`}
            onClick={() => onChange({ ...person, k401_pct: 0 })}
            className="-mt-2 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
          >
            <X size={13} />
          </button>
        </div>
      )}
      <div className="mt-3 border-t border-slate-100 pt-2.5">
        <p className="mb-1.5 text-[11px] text-slate-400">Paycheck deductions</p>
        {person.items.map((item, index) => (
          <div key={item.id} className="mb-2 rounded-lg border border-slate-100 p-1.5">
            <div className="grid grid-cols-[minmax(0,1fr)_64px_58px_26px] items-center gap-1.5">
              <input
                value={item.name}
                placeholder="Name"
                aria-label="Deduction name"
                onChange={(e) => {
                  const items = [...person.items]
                  items[index] = { ...item, name: e.target.value }
                  onChange({ ...person, items })
                }}
                className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs"
              />
              <NumberInput
                value={item.amt}
                aria-label="Deduction amount"
                onValue={(amt) => {
                  const items = [...person.items]
                  items[index] = { ...item, amt }
                  onChange({ ...person, items })
                }}
                className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-right text-xs tabular-nums"
              />
              <select
                value={item.per}
                aria-label="Per month or per year"
                onChange={(e) => {
                  const items = [...person.items]
                  items[index] = { ...item, per: e.target.value as 'mo' | 'yr' }
                  onChange({ ...person, items })
                }}
                className="w-full rounded-md border border-slate-200 bg-white px-1 py-1 text-[11px] text-slate-600"
              >
                <option value="mo">/ mo</option>
                <option value="yr">/ yr</option>
              </select>
              <button
                title="Remove deduction"
                aria-label={`Remove ${item.name || 'deduction'}`}
                onClick={() => onChange({ ...person, items: person.items.filter((i) => i.id !== item.id) })}
                className="justify-self-end rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
              >
                <X size={13} />
              </button>
            </div>
            <select
              value={item.type}
              aria-label="Tax treatment"
              onChange={(e) => {
                const items = [...person.items]
                items[index] = { ...item, type: e.target.value as PlanDeductionType }
                onChange({ ...person, items })
              }}
              className="mt-1.5 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-500"
            >
              {Object.entries(PLAN_DED_TYPES).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div className="mt-1 flex flex-wrap gap-1.5">
          <button
            onClick={() => onChange({ ...person, items: [...person.items, { id: planId(), name: '', amt: 0, per: 'mo', type: 's125' }] })}
            className="rounded-lg border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700"
          >
            + Add deduction
          </button>
          {person.k401_pct === 0 && (
            <button
              onClick={() => onChange({ ...person, k401_pct: 5 })}
              className="rounded-lg border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700"
            >
              + 401(k)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- page -- */

export default function Plan() {
  const [plan, setPlan] = useState<PlanState | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const [scenarios, setScenarios] = useState<{ name: string; saved_by: string; saved_at: string }[]>([])
  const [scenarioSel, setScenarioSel] = useState('')
  const [actualMonth, setActualMonth] = useState(currentMonth)
  // Planning usually happens for the month ahead — default there once past mid-month.
  const [applyMonth, setApplyMonth] = useState(() =>
    new Date().getDate() >= 20 ? shiftMonth(currentMonth(), 1) : currentMonth(),
  )
  const [applyMode, setApplyMode] = useState<'default' | 'month'>('default')
  const [applyNote, setApplyNote] = useState<string | null>(null)
  const [flowKind, setFlowKind] = useState<'month' | 'avg' | 'yr'>('month')
  const [flowMonth, setFlowMonth] = useState(currentMonth())
  const { data: actuals } = useApi<ActualsResponse>(`/plan/actuals?month=${actualMonth}`)
  const dirtyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const planRef = useRef<PlanState | null>(null)
  planRef.current = plan

  useEffect(() => {
    void api.get<{ state: PlanState; saved_at: string | null; saved_by: string | null; bootstrapped?: boolean }>('/plan').then((r) => {
      setPlan(r.state)
      setBootstrapped(!!r.bootstrapped)
      setSaveStatus(
        r.saved_at ? `Saved ${new Date(r.saved_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} by ${r.saved_by}` : '',
      )
    })
    void api.get<{ scenarios: { name: string; saved_by: string; saved_at: string }[] }>('/plan/scenarios').then((r) => setScenarios(r.scenarios))
    return () => {
      if (dirtyTimer.current) clearTimeout(dirtyTimer.current)
    }
  }, [])

  function update(mutate: (draft: PlanState) => void): void {
    setPlan((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      mutate(next)
      return next
    })
    setSaveStatus('Saving…')
    if (dirtyTimer.current) clearTimeout(dirtyTimer.current)
    dirtyTimer.current = setTimeout(() => {
      const state = planRef.current
      if (!state) return
      api
        .put<{ saved_at: string }>('/plan', { state })
        .then((r) => setSaveStatus(`Saved ${new Date(r.saved_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`))
        .catch(() => setSaveStatus('Save failed — will retry on next change'))
    }, 900)
  }

  async function refreshScenarios(): Promise<void> {
    const r = await api.get<{ scenarios: { name: string; saved_by: string; saved_at: string }[] }>('/plan/scenarios')
    setScenarios(r.scenarios)
  }

  async function saveScenario(): Promise<void> {
    const name = prompt('Scenario name (e.g. “Aggressive savings”, “If Sam goes part-time”):')
    if (!name || !plan) return
    await api.post('/plan/scenarios', { name: name.trim().slice(0, 60), state: plan })
    await refreshScenarios()
    setScenarioSel(name.trim().slice(0, 60))
  }

  async function loadScenario(): Promise<void> {
    if (!scenarioSel) return
    const r = await api.get<{ state: PlanState }>(`/plan/scenarios/${encodeURIComponent(scenarioSel)}`)
    setPlan(r.state)
    update(() => {})
  }

  async function deleteScenario(): Promise<void> {
    if (!scenarioSel || !confirm(`Delete scenario “${scenarioSel}”?`)) return
    await api.delete(`/plan/scenarios/${encodeURIComponent(scenarioSel)}`)
    setScenarioSel('')
    await refreshScenarios()
  }

  async function applyToBudget(): Promise<void> {
    if (!plan) return
    const label = fmtMonth(applyMonth)
    const message =
      applyMode === 'default'
        ? `Set as the default budget from ${label} onward? Hand-set months and older months stay as they are.`
        : `Write these amounts into ${label} only? Later defaults will leave that month alone.`
    if (!confirm(message)) return
    const r = await api.post<{ applied: number; created: number }>('/plan/apply', {
      month: applyMonth,
      mode: applyMode,
      state: plan,
    })
    const detail = `${r.applied} envelope${r.applied === 1 ? '' : 's'}${r.created ? `, ${r.created} created` : ''}`
    setApplyNote(applyMode === 'default' ? `Default set from ${label} onward — ${detail}.` : `${label} only — ${detail}.`)
  }

  async function pullFromActuals(): Promise<void> {
    if (!confirm('Re-pull incomes and category averages from your tracked data? Your current plan numbers will be replaced (save a scenario first if you want to keep them).')) return
    const r = await api.post<{ state: PlanState }>('/plan/pull')
    setPlan(r.state)
    update(() => {})
  }

  const math = useMemo(() => (plan ? computePlan(plan) : null), [plan])

  /* ---- plan vs actual matching (before any early return — hooks stay stable) ---- */
  const actualRows = useMemo(() => {
    if (!actuals || !plan) return null
    const byId = new Map(actuals.by_category.map((c) => [c.category_id, c]))
    const byName = new Map(actuals.by_category.map((c) => [c.name.toLowerCase(), c]))
    const matchedIds = new Set<string>()
    const rows = plan.cats.map((cat) => {
      const match = (cat.fold_category_id && byId.get(cat.fold_category_id)) || byName.get(cat.name.trim().toLowerCase()) || null
      if (match) matchedIds.add(match.category_id)
      return { cat, actual: match ? match.total_cents / 100 : null }
    })
    const unplanned = actuals.by_category
      .filter((c) => !matchedIds.has(c.category_id))
      .sort((x, y) => y.total_cents - x.total_cents)
    return { rows, unplanned }
  }, [actuals, plan])

  if (!plan || !math) return null
  const [a, b] = plan.people
  const colorA = memberVar(a.color)
  const colorB = memberVar(b.color)
  const fair = fairness(plan, math)
  const saveMo = math.alloc.savings + math.alloc.invest + math.alloc.trip + (math.people[0].k401 + math.people[1].k401) / 12
  const tripMonths = math.alloc.trip > 0.5 ? plan.trip_goal / math.alloc.trip : null
  const tripEta = tripMonths ? new Date(new Date().setMonth(new Date().getMonth() + Math.ceil(tripMonths))) : null

  // Monthly view averages the year; call out the extra-check months explicitly.
  const rhythmParts = plan.people
    .filter((p) => (p.pay_freq === 'biweekly' || p.pay_freq === 'weekly') && planAnnualGross(p) > 0)
    .map((p) =>
      p.pay_freq === 'biweekly'
        ? `${p.name}: 2 checks most months (${fmt$(planPerCheck(p) * 2)} gross), 2 months a year bring a 3rd`
        : `${p.name}: 4 checks most months (${fmt$(planPerCheck(p) * 4)} gross), a few bring a 5th`,
    )
  const payRhythmNote = rhythmParts.length > 0 ? `Average month = a year ÷ 12. ${rhythmParts.join(' · ')}.` : ''

  // Month view: say exactly how many checks land, and nudge for a payday anchor.
  const checksParts = plan.people
    .filter((p) => planAnnualGross(p) > 0)
    .map((p) => {
      const n = checksInMonth(p, flowMonth)
      return `${p.name}: ${n} ${n === 1 ? 'check' : 'checks'} (${fmt$(planMonthGross(p, flowMonth))} gross)`
    })
  const needsAnchor = plan.people.some(
    (p) => (p.pay_freq === 'biweekly' || p.pay_freq === 'weekly') && !p.next_payday && planAnnualGross(p) > 0,
  )
  const monthChecksNote =
    checksParts.length > 0
      ? `${checksParts.join(' · ')}.${needsAnchor ? ' Set a next payday in section 1 to pin down the 3-check months.' : ''}`
      : ''

  const elapsedPct = actuals ? actuals.today_day / actuals.days_in_month : 1
  const isCurrentMonth = actualMonth === currentMonth()

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Plan</h1>
          <p className="text-sm text-slate-500">
            One pot, two people. Drag, type, add your own lines — everything recalculates. Then see how the month is
            actually tracking against it.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void pullFromActuals()}>
          <RefreshCw size={14} /> Pull from tracked data
        </Button>
      </div>

      <Card className="flex flex-wrap items-center gap-2 !py-2.5 text-xs text-slate-500">
        <span>Scenario</span>
        <select
          value={scenarioSel}
          onChange={(e) => setScenarioSel(e.target.value)}
          aria-label="Saved scenarios"
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600"
        >
          <option value="">— live plan —</option>
          {scenarios.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.saved_by}, {new Date(s.saved_at).toLocaleDateString()})
            </option>
          ))}
        </select>
        <button onClick={() => void saveScenario()} className="rounded-lg border border-slate-200 px-2.5 py-1.5 hover:border-slate-300 hover:text-slate-700">
          Save as…
        </button>
        <button onClick={() => void loadScenario()} className="rounded-lg border border-slate-200 px-2.5 py-1.5 hover:border-slate-300 hover:text-slate-700">
          Load
        </button>
        <button onClick={() => void deleteScenario()} className="rounded-lg border border-slate-200 px-2.5 py-1.5 hover:border-red-300 hover:text-red-600">
          Delete
        </button>
        <span className="ml-auto text-slate-400">{bootstrapped ? 'Pre-filled from your tracked data' : saveStatus}</span>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl bg-gradient-to-br from-violet-500 via-violet-600 to-violet-700 p-5 !py-4 shadow-sm">
          <p className="text-xs text-on-accent opacity-80">Take-home pool</p>
          <p className="mt-0.5 text-[27px] font-bold leading-tight text-on-accent">{fmt$(math.pool_mo)}<span className="text-sm font-normal opacity-70">/mo</span></p>
          <p className="mt-0.5 text-[11px] text-on-accent opacity-75">
            {fmt$(math.pool)} a year · {a.name} {(math.people[0].share * 100).toFixed(1)}% / {b.name} {(math.people[1].share * 100).toFixed(1)}%
          </p>
        </div>
        <Card className="!py-4">
          <p className="text-xs text-slate-500">Total tax rate (on gross)</p>
          <p className="mt-0.5 text-[27px] font-bold leading-tight">{math.gross > 0 ? ((math.tax / math.gross) * 100).toFixed(1) : '0.0'}%</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{fmt$(math.tax / 12)}/mo — federal + state + FICA</p>
        </Card>
        <Card className="!py-4">
          <p className="text-xs text-slate-500">Saved + invested</p>
          <p className="mt-0.5 text-[27px] font-bold leading-tight">{fmt$(saveMo)}<span className="text-sm font-normal text-slate-400">/mo</span></p>
          <p className="mt-0.5 text-[11px] text-slate-400">incl. 401(k) — {math.gross > 0 ? (((saveMo * 12) / math.gross) * 100).toFixed(1) : '0'}% of gross</p>
        </Card>
        <Card className="!py-4">
          <p className="text-xs text-slate-500">Trip fund</p>
          <p className="mt-0.5 text-[27px] font-bold leading-tight">{fmt$(math.alloc.trip)}<span className="text-sm font-normal text-slate-400">/mo</span></p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {tripMonths && tripEta
              ? `${fmt$(plan.trip_goal)} goal ≈ ${tripMonths.toFixed(1)} mo (${tripEta.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})`
              : 'set a trip % to see a date'}
          </p>
        </Card>
      </div>

      <Card>
        <SectionTitle n={1} title="Incomes & paycheck deductions" />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <PersonPanel person={a} onChange={(next) => update((d) => { d.people[0] = next })} />
          <PersonPanel person={b} onChange={(next) => update((d) => { d.people[1] = next })} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle n={2} title="The flow of every dollar" />
          <div className="flex flex-wrap items-center gap-2">
            {flowKind === 'month' && (
              <div className="flex items-center">
                <button onClick={() => setFlowMonth(shiftMonth(flowMonth, -1))} aria-label="Previous month" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
                  <ChevronLeft size={15} />
                </button>
                <span className="w-28 text-center text-xs font-semibold">{fmtMonth(flowMonth)}</span>
                <button onClick={() => setFlowMonth(shiftMonth(flowMonth, 1))} aria-label="Next month" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
                  <ChevronRight size={15} />
                </button>
              </div>
            )}
            <div className="flex rounded-xl bg-slate-100 p-1 text-xs">
              {([
                ['month', 'Month'],
                ['avg', 'Average'],
                ['yr', 'Year'],
              ] as const).map(([kind, label]) => (
                <button
                  key={kind}
                  onClick={() => setFlowKind(kind)}
                  className={cls(
                    'rounded-lg px-3 py-1 font-medium transition-colors',
                    flowKind === kind ? 'bg-white shadow-sm' : 'text-slate-500',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {flowKind === 'month' && monthChecksNote && <p className="mt-1 text-[11px] text-slate-400">{monthChecksNote}</p>}
        {flowKind === 'avg' && payRhythmNote && <p className="mt-1 text-[11px] text-slate-400">{payRhythmNote}</p>}
        <div className="mt-2">
          <PlanSankey
            state={plan}
            math={math}
            view={flowKind === 'month' ? { kind: 'month', month: flowMonth } : { kind: flowKind }}
          />
        </div>
      </Card>

      <Card>
        <SectionTitle n={3} title="Taxes" />
        <div className="mb-3 inline-flex overflow-hidden rounded-xl border border-slate-200 text-xs">
          <button
            onClick={() =>
              update((d) => {
                d.tax_mode = 'auto'
              })
            }
            className={cls('px-3.5 py-1.5', plan.tax_mode === 'auto' ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-500')}
          >
            Automatic — 2026 law
          </button>
          <button
            onClick={() =>
              update((d) => {
                // Start each manual rate from what the law currently computes.
                d.people.forEach((person, i) => {
                  const m = math.people[i]
                  if (m.gross > 0) person.manual_tax_pct = Math.round(((m.share_tax + m.fica) / m.gross) * 1000) / 10
                })
                d.tax_mode = 'manual'
              })
            }
            className={cls('px-3.5 py-1.5', plan.tax_mode === 'manual' ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-500')}
          >
            Manual rates
          </button>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {plan.tax_mode === 'auto' ? (
            <div>
              <div className="mb-3 inline-flex overflow-hidden rounded-xl border border-slate-200 text-xs">
                <button
                  onClick={() => update((d) => { d.filing = 'mfj' })}
                  className={cls('px-3.5 py-1.5', plan.filing === 'mfj' ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-500')}
                >
                  Married filing jointly
                </button>
                <button
                  onClick={() => update((d) => { d.filing = 'single' })}
                  className={cls('px-3.5 py-1.5', plan.filing === 'single' ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-500')}
                >
                  Two single filers
                </button>
              </div>
              <SliderRow
                label="State income tax"
                value={plan.state_rate}
                min={0}
                max={12}
                step={0.05}
                onChange={(v) => update((d) => { d.state_rate = v })}
              />
              <NumberField
                label={plan.filing === 'mfj' ? 'Federal deduction (standard: $32,200)' : 'Federal deduction, couple total (half each)'}
                value={plan.std_ded}
                onChange={(v) => update((d) => { d.std_ded = v })}
              />
              <p className="mt-2 text-[11px] text-slate-400">Flat state rate on federal taxable income — 0% for TX, FL, WA, TN.</p>
            </div>
          ) : (
            <div>
              {([0, 1] as const).map((index) => (
                <SliderRow
                  key={index}
                  label={`${plan.people[index].name} — effective rate`}
                  value={plan.people[index].manual_tax_pct}
                  min={0}
                  max={60}
                  step={0.5}
                  onChange={(v) => update((d) => { d.people[index].manual_tax_pct = v })}
                />
              ))}
              <p className="mt-2 text-[11px] text-slate-400">One flat rate per person on gross — covers federal + state + FICA.</p>
            </div>
          )}
          <div className="text-xs">
            {(plan.tax_mode === 'manual'
              ? [
                  ['Combined gross', `${fmt$(math.gross)}/yr`, false],
                  [`${a.name} — ${plan.people[0].manual_tax_pct.toFixed(1)}% of ${fmt$(math.people[0].gross)}`, fmt$(math.people[0].share_tax), false],
                  [`${b.name} — ${plan.people[1].manual_tax_pct.toFixed(1)}% of ${fmt$(math.people[1].gross)}`, fmt$(math.people[1].share_tax), false],
                  ...(math.pre > 0 ? [['Pre-tax deductions', `−${fmt$(math.pre)}`, false] as [string, string, boolean]] : []),
                  ...(math.post > 0 ? [['Post-tax deductions', `−${fmt$(math.post)}`, false] as [string, string, boolean]] : []),
                  ['Total tax', `${fmt$(math.tax)}/yr`, true],
                  ['Take-home pool', `${fmt$(math.pool)}/yr`, true],
                ]
              : [
                  ['Combined gross', `${fmt$(math.gross)}/yr`, false],
                  ['Pre-tax deductions', `−${fmt$(math.pre)}`, false],
                  ['Federal deduction', `−${fmt$(plan.std_ded)}`, false],
                  ['Federal taxable income', fmt$(math.taxable), false],
                  ['Federal income tax', fmt$(math.fed), false],
                  [`State income tax (${plan.state_rate.toFixed(2)}%)`, fmt$(math.state), false],
                  [`FICA — ${a.name} / ${b.name}`, `${fmt$(math.people[0].fica)} / ${fmt$(math.people[1].fica)}`, false],
                  ...(math.post > 0 ? [['Post-tax deductions', `−${fmt$(math.post)}`, false] as [string, string, boolean]] : []),
                  ['Total tax', `${fmt$(math.tax)}/yr`, true],
                  ['Take-home pool', `${fmt$(math.pool)}/yr`, true],
                ]
            ).map(([label, value, sum], i) => (
              <div key={i} className={cls('flex justify-between border-b border-slate-100 py-1.5', sum && 'border-b-0 border-t border-slate-300 font-semibold')}>
                <span className={cls(sum ? 'text-slate-800' : 'text-slate-500')}>{label}</span>
                <span className="tabular-nums text-slate-800">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle n={4} title="Split the take-home pool" hint="Drag one — the rest rebalance to keep 100%." />
        {PLAN_ALLOC_KEYS.map((key) => {
          const locked = plan.alloc_locked.includes(key)
          const setPct = (v: number): void =>
            update((d) => {
              d.alloc = rebalanceAlloc(d.alloc, key, v, d.alloc_locked.filter((k) => k !== key))
            })
          return (
            <div
              key={key}
              className="mb-2.5 grid grid-cols-[130px_1fr_76px_96px_30px] items-center gap-2 text-sm sm:grid-cols-[180px_1fr_84px_108px_32px] sm:gap-3"
            >
              <span className="flex items-center gap-2 text-xs sm:text-[13px]">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: ALLOC_META[key].color }} />
                <span className="truncate">{ALLOC_META[key].label}</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={0.5}
                value={plan.alloc[key]}
                disabled={locked}
                aria-label={`${ALLOC_META[key].label} percent of take-home`}
                onChange={(e) => setPct(parseFloat(e.target.value))}
                className="w-full accent-[var(--color-accent)] disabled:opacity-40"
              />
              <span className="flex items-center justify-end gap-0.5">
                <NumberInput
                  value={Math.round(plan.alloc[key] * 10) / 10}
                  disabled={locked}
                  aria-label={`${ALLOC_META[key].label} percent value`}
                  onValue={(v) => setPct(Math.min(100, v))}
                  className="w-12 rounded-md border border-slate-200 bg-white px-1 py-0.5 text-right text-xs font-semibold tabular-nums disabled:opacity-50"
                />
                <span className="text-xs text-slate-400">%</span>
              </span>
              <span className="flex items-center justify-end gap-0.5">
                <NumberInput
                  value={Math.round(math.alloc[key])}
                  disabled={locked}
                  aria-label={`${ALLOC_META[key].label} dollars per month`}
                  onValue={(v) => setPct(math.pool_mo > 0 ? Math.min(100, (v / math.pool_mo) * 100) : 0)}
                  className="w-16 rounded-md border border-slate-200 bg-white px-1 py-0.5 text-right text-xs tabular-nums text-slate-600 disabled:opacity-50"
                />
                <span className="text-[10px] text-slate-400">/mo</span>
              </span>
              <button
                title={locked ? 'Unlock — let rebalancing move it again' : 'Lock this bucket in place'}
                aria-label={`${locked ? 'Unlock' : 'Lock'} ${ALLOC_META[key].label}`}
                onClick={() =>
                  update((d) => {
                    d.alloc_locked = locked ? d.alloc_locked.filter((k) => k !== key) : [...d.alloc_locked, key]
                  })
                }
                className={cls(
                  'justify-self-center rounded p-1 transition-colors',
                  locked ? 'text-violet-600 hover:bg-violet-50' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500',
                )}
              >
                {locked ? <Lock size={14} /> : <LockOpen size={14} />}
              </button>
            </div>
          )
        })}
        <div className="mt-4 max-w-md">
          <div className="grid grid-cols-[1fr_110px_70px] items-center gap-2.5 text-xs text-slate-500">
            <span>Trip goal ($)</span>
            <NumberInput
              value={plan.trip_goal}
              onValue={(v) => update((d) => { d.trip_goal = v })}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm tabular-nums"
            />
            <span className="text-right text-sm font-medium tabular-nums text-slate-700">{tripMonths ? `${tripMonths.toFixed(1)} mo` : '—'}</span>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle n={5} title="Planned shared budget" />
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-right text-slate-500">
                <th className="py-1.5 pr-2 text-left font-semibold">Category</th>
                <th className="py-1.5 pr-2 text-left font-semibold">Amount</th>
                <th className="py-1.5 pr-2 font-semibold">{a.name} contribution</th>
                <th className="py-1.5 pr-2 font-semibold">{b.name} contribution</th>
                <th className="py-1.5 pl-3 text-left font-semibold">Benefit split</th>
                <th className="py-1.5 pr-2 font-semibold">{a.name} allocation</th>
                <th className="py-1.5 pr-2 font-semibold">{b.name} allocation</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {plan.cats.map((cat, index) => {
                const monthly = math.cat_monthly[index] ?? 0
                return (
                  <tr key={cat.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-2">
                      <input
                        value={cat.name}
                        aria-label="Category name"
                        onChange={(e) => update((d) => { d.cats[index].name = e.target.value })}
                        className="w-full min-w-32 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-1">
                        <NumberInput
                          value={cat.amt}
                          aria-label={cat.mode === 'pct' ? `${cat.name} percent of take-home` : `${cat.name} monthly amount`}
                          onValue={(amt) => update((d) => { d.cats[index].amt = amt })}
                          className="w-16 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-right text-xs tabular-nums"
                        />
                        <span className="inline-flex overflow-hidden rounded-md border border-slate-200">
                          {(['fixed', 'pct'] as const).map((mode) => (
                            <button
                              key={mode}
                              title={mode === 'fixed' ? 'Fixed dollars per month' : 'Percent of take-home'}
                              onClick={() =>
                                update((d) => {
                                  const target = d.cats[index]
                                  if (target.mode === mode) return
                                  // Convert the value so the line's dollars don't jump.
                                  const currentMonthly = math.cat_monthly[index] ?? 0
                                  target.mode = mode
                                  target.amt =
                                    mode === 'pct'
                                      ? math.pool_mo > 0
                                        ? Math.round((currentMonthly / math.pool_mo) * 1000) / 10
                                        : 0
                                      : Math.round(currentMonthly)
                                })
                              }
                              className={cls(
                                'px-1.5 py-0.5 text-[10px] font-semibold',
                                cat.mode === mode ? 'bg-slate-100 text-slate-700' : 'text-slate-400',
                              )}
                            >
                              {mode === 'fixed' ? '$' : '%'}
                            </button>
                          ))}
                        </span>
                        {cat.mode === 'pct' && (
                          <span className="whitespace-nowrap text-[10px] tabular-nums text-slate-400">= {fmt$(monthly)}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-slate-500">{fmt$(monthly * math.people[0].share)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-slate-500">{fmt$(monthly * math.people[1].share)}</td>
                    <td className="min-w-36 py-1.5 pl-3 align-middle">
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={cat.benefit_a}
                          aria-label={`${cat.name} percent of benefit to ${a.name}`}
                          onChange={(e) => update((d) => { d.cats[index].benefit_a = parseFloat(e.target.value) })}
                          className="w-20 shrink-0 accent-[var(--color-accent)]"
                        />
                        <span className="flex items-center gap-0.5 whitespace-nowrap text-[10px] tabular-nums text-slate-400">
                          <NumberInput
                            value={cat.benefit_a}
                            aria-label={`${cat.name} benefit percent to ${a.name}`}
                            onValue={(v) => update((d) => { d.cats[index].benefit_a = Math.min(100, Math.max(0, v)) })}
                            className="w-9 rounded border border-slate-200 bg-white px-1 py-0.5 text-right text-[10px] tabular-nums"
                          />
                          <span>/ {100 - cat.benefit_a}</span>
                        </span>
                      </div>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-slate-500">{fmt$((monthly * cat.benefit_a) / 100)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-slate-500">{fmt$((monthly * (100 - cat.benefit_a)) / 100)}</td>
                    <td className="py-1.5 text-right">
                      <span className="inline-flex items-center">
                        <button
                          title="Move up"
                          aria-label={`Move ${cat.name} up`}
                          disabled={index === 0}
                          onClick={() => update((d) => { const [row] = d.cats.splice(index, 1); d.cats.splice(index - 1, 0, row) })}
                          className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:invisible"
                        >
                          <ChevronUp size={13} />
                        </button>
                        <button
                          title="Move down"
                          aria-label={`Move ${cat.name} down`}
                          disabled={index === plan.cats.length - 1}
                          onClick={() => update((d) => { const [row] = d.cats.splice(index, 1); d.cats.splice(index + 1, 0, row) })}
                          className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:invisible"
                        >
                          <ChevronDown size={13} />
                        </button>
                        <button
                          title="Remove category"
                          aria-label={`Remove ${cat.name}`}
                          onClick={() => update((d) => { d.cats.splice(index, 1) })}
                          className="ml-0.5 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                        >
                          <X size={13} />
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t border-slate-100 italic text-slate-500">
                <td className="py-1.5 pr-2">Buffer / not yet assigned</td>
                <td className={cls('py-1.5 pr-2 text-left tabular-nums', math.buffer < 0 && 'font-semibold not-italic text-red-600')}>{fmt$(math.buffer)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmt$(math.buffer * math.people[0].share)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmt$(math.buffer * math.people[1].share)}</td>
                <td className="py-1.5 pl-3 text-left text-slate-400">50 / 50</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmt$(math.buffer / 2)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmt$(math.buffer / 2)}</td>
                <td />
              </tr>
              <tr className="border-t border-slate-300 font-semibold">
                <td className="py-1.5 pr-2">Total (= living bucket)</td>
                <td className="py-1.5 pr-2 text-left tabular-nums">{fmt$(math.alloc.living)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmt$(math.alloc.living * math.people[0].share)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmt$(math.alloc.living * math.people[1].share)}</td>
                <td />
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {fmt$(plan.cats.reduce((sum, c, i) => sum + ((math.cat_monthly[i] ?? 0) * c.benefit_a) / 100, 0) + math.buffer / 2)}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {fmt$(plan.cats.reduce((sum, c, i) => sum + ((math.cat_monthly[i] ?? 0) * (100 - c.benefit_a)) / 100, 0) + math.buffer / 2)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => update((d) => { d.cats.push({ id: planId(), name: '', mode: 'fixed', amt: 0, benefit_a: 50 }) })}
            className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700"
          >
            <Plus size={11} className="mr-1 inline" />
            Add category
          </button>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Button variant="secondary" onClick={() => void applyToBudget()}>
              Apply to budget <ArrowRight size={13} />
            </Button>
            <select
              value={applyMode}
              aria-label="How to apply the plan"
              onChange={(e) => setApplyMode(e.target.value as 'default' | 'month')}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600"
            >
              <option value="default">as our default from</option>
              <option value="month">for just</option>
            </select>
            <input
              type="month"
              value={applyMonth}
              aria-label="Which month to apply the plan to"
              onChange={(e) => { if (e.target.value) setApplyMonth(e.target.value) }}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
            />
            {applyMode === 'default' && <span className="text-xs text-slate-400">onward</span>}
          </span>
          {applyNote && (
            <span className="text-xs font-medium text-emerald-600">
              {applyNote} <Link to="/budget" className="underline">Open the budget</Link>
            </span>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle n={6} title="The plan vs. what actually happened" />
          <div className="flex items-center gap-1">
            <button onClick={() => setActualMonth(shiftMonth(actualMonth, -1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
              <ChevronLeft size={16} />
            </button>
            <span className="w-28 text-center text-sm font-semibold">{fmtMonth(actualMonth)}</span>
            <button
              onClick={() => setActualMonth(shiftMonth(actualMonth, 1))}
              disabled={isCurrentMonth}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        {!actuals || !actualRows ? null : actuals.by_category.length === 0 && plan.cats.length === 0 ? (
          <EmptyState title={`Nothing tracked in ${fmtMonth(actualMonth)}`}>
            Add or <Link to="/transactions" className="underline">import</Link> spending and the plan gets its mirror.
          </EmptyState>
        ) : (
          <>
            {isCurrentMonth && (
              <p className="mb-3 text-xs text-slate-400">
                Day {actuals.today_day} of {actuals.days_in_month} — {Math.round(elapsedPct * 100)}% through the month.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-right text-slate-500">
                    <th className="py-1.5 pr-2 text-left font-semibold">Category</th>
                    <th className="py-1.5 pr-2 font-semibold">Planned</th>
                    <th className="py-1.5 pr-2 font-semibold">Spent</th>
                    <th className="w-2/5 py-1.5 pl-3 text-left font-semibold">Progress</th>
                    <th className="py-1.5 pr-2 font-semibold">{isCurrentMonth ? 'Run rate' : 'vs plan'}</th>
                  </tr>
                </thead>
                <tbody>
                  {actualRows.rows
                    .map((row, i) => ({ ...row, planned: math.cat_monthly[i] ?? 0 }))
                    .filter((row) => row.planned > 0 || row.actual != null)
                    .map((row) => {
                      const spent = row.actual ?? 0
                      const runRate = isCurrentMonth && elapsedPct > 0 ? spent / elapsedPct : spent
                      // Red means actually over the plan — never just a scary
                      // extrapolation of a fixed bill that was paid on the 1st.
                      const over = spent > row.planned && row.planned > 0
                      const paidExactly = row.actual != null && row.planned > 0 && Math.abs(spent - row.planned) < 1
                      const pct = row.planned > 0 ? Math.min(100, (spent / row.planned) * 100) : spent > 0 ? 100 : 0
                      return (
                        <tr key={row.cat.id} className="border-t border-slate-100">
                          <td className="py-2 pr-2">{row.cat.name || <span className="text-slate-300">unnamed</span>}</td>
                          <td className="py-2 pr-2 text-right tabular-nums text-slate-500">{fmt$(row.planned)}</td>
                          <td className="py-2 pr-2 text-right font-semibold tabular-nums">{row.actual == null ? '—' : fmt$(spent)}</td>
                          <td className="py-2 pl-3">
                            <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${pct}%`, backgroundColor: over ? '#ef4444' : 'var(--color-accent)' }}
                              />
                              {isCurrentMonth && row.cat.amt > 0 && (
                                <span
                                  className="absolute inset-y-0 w-0.5 bg-slate-400/70"
                                  style={{ left: `${Math.min(100, elapsedPct * 100)}%` }}
                                  title="Where today sits in the month"
                                />
                              )}
                            </div>
                          </td>
                          <td className={cls('py-2 pr-2 text-right tabular-nums', over ? 'font-semibold text-red-600' : 'text-slate-400')}>
                            {row.actual == null
                              ? '—'
                              : paidExactly
                                ? '✓ paid'
                                : over
                                  ? `${fmt$(spent - row.cat.amt)} over`
                                  : isCurrentMonth
                                    ? `≈ ${fmt$(runRate)}`
                                    : fmt$(spent - row.cat.amt)}
                          </td>
                        </tr>
                      )
                    })}
                  {actualRows.unplanned.length > 0 && (
                    <tr className="border-t border-slate-100 text-slate-400">
                      <td className="py-2 pr-2 italic">
                        Not in the plan: {actualRows.unplanned.map((c) => c.name).slice(0, 4).join(', ')}
                        {actualRows.unplanned.length > 4 ? '…' : ''}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">—</td>
                      <td className="py-2 pr-2 text-right font-semibold tabular-nums text-slate-500">
                        {fmt$(actualRows.unplanned.reduce((sum, c) => sum + c.total_cents, 0) / 100)}
                      </td>
                      <td />
                      <td />
                    </tr>
                  )}
                  <tr className="border-t border-slate-300 font-semibold">
                    <td className="py-2 pr-2">Shared total</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{fmt$(math.alloc.living)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{fmtMoney(actuals.shared_total_cents)}</td>
                    <td className="py-2 pl-3">
                      <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${math.alloc.living > 0 ? Math.min(100, (actuals.shared_total_cents / 100 / math.alloc.living) * 100) : 0}%`,
                            backgroundColor:
                              actuals.shared_total_cents / 100 > math.alloc.living ? '#ef4444' : 'var(--color-accent)',
                          }}
                        />
                      </div>
                    </td>
                    <td
                      className={cls(
                        'py-2 pr-2 text-right tabular-nums',
                        actuals.shared_total_cents / 100 > math.alloc.living && 'text-red-600',
                      )}
                    >
                      {isCurrentMonth && elapsedPct > 0
                        ? `≈ ${fmt$(actuals.shared_total_cents / 100 / elapsedPct)}`
                        : fmt$(actuals.shared_total_cents / 100 - math.alloc.living)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle n={7} title="Personal allowances" />
          <div className="inline-flex overflow-hidden rounded-xl border border-slate-200 text-xs">
            <button
              onClick={() => update((d) => { d.personal_mode = 'equal' })}
              className={cls('px-3.5 py-1.5', plan.personal_mode === 'equal' ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-500')}
            >
              Equal dollars
            </button>
            <button
              onClick={() => update((d) => { d.personal_mode = 'prop' })}
              className={cls('px-3.5 py-1.5', plan.personal_mode === 'prop' ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-500')}
            >
              Proportional to income
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 p-3" style={{ borderLeft: `4px solid ${colorA}` }}>
              <p className="text-[11px] text-slate-400">{a.name} / month</p>
              <p className="text-xl font-bold">{fmt$(math.personal_a)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3" style={{ borderLeft: `4px solid ${colorB}` }}>
              <p className="text-[11px] text-slate-400">{b.name} / month</p>
              <p className="text-xl font-bold">{fmt$(math.personal_b)}</p>
            </div>
          </div>
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            {plan.personal_mode === 'equal'
              ? `Equal mode: identical allowances, whatever each of you earns. Proportional would give ${a.name} ${fmt$(math.alloc.personal * math.people[0].share)} and ${b.name} ${fmt$(math.alloc.personal * math.people[1].share)} — a ${fmt$(Math.abs(math.alloc.personal * (math.people[0].share - math.people[1].share)))}/mo gap.`
              : `Proportional mode: allowances follow income share, a ${fmt$(Math.abs(math.personal_a - math.personal_b))}/mo gap. Equal mode would give you ${fmt$(math.alloc.personal / 2)} each.`}
          </p>
        </Card>

        <Card>
          <SectionTitle
            n={8}
            title="Fairness check"
            hint="What each of you puts in vs. what flows back."
          />
          {([0, 1] as const).map((index) => {
            const person = plan.people[index]
            const color = index === 0 ? colorA : colorB
            const maxV = Math.max(...fair.puts, ...fair.gets, 1)
            return (
              <div key={index} className="mb-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                  <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: color }} />
                  {person.name}
                </p>
                {[
                  ['Puts in', fair.puts[index], 1],
                  ['Gets out', fair.gets[index], 0.38],
                ].map(([label, value, opacity]) => (
                  <div key={label as string} className="mb-1 grid grid-cols-[56px_1fr_80px] items-center gap-2 text-[11px] text-slate-500">
                    <span>{label}</span>
                    <div className="h-3.5">
                      <div
                        className="h-full rounded-r"
                        style={{ width: `${(Math.max(0, value as number) / maxV) * 100}%`, backgroundColor: color, opacity: opacity as number }}
                      />
                    </div>
                    <span className="tabular-nums text-slate-700">{fmt$(value as number)}/mo</span>
                  </div>
                ))}
              </div>
            )
          })}
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            {(() => {
              const delta = fair.gets[0] - fair.puts[0]
              const funder = delta <= 0 ? a.name : b.name
              const other = delta <= 0 ? b.name : a.name
              return `${funder} currently net-funds the pool by ${fmt$(Math.abs(delta))}/mo; the same amount flows toward ${other}'s side. In a one-pot life that's a feature, not a bug — this view just keeps it a known, discussed number instead of a silent one.`
            })()}
          </p>
        </Card>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-400">
        <b className="text-slate-500">Assumptions.</b> 2026 federal brackets and standard deductions (married-filing-jointly
        $32,200 / single $16,100). FICA = 6.2% Social Security up to the $184,500 wage base + 1.45% Medicare, per person;
        medical/dental/vision and HSA/FSA lines reduce FICA wages, 401(k) and other pre-tax don't, post-tax lines reduce
        nothing. State tax = one flat rate on federal taxable income. No credits, surtaxes, or local taxes — built for
        planning conversations, not filing. Your data stays on your server; scenarios are snapshots of this whole page.
      </p>
    </div>
  )
}
