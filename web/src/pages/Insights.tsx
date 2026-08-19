import { useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Link } from 'react-router-dom'
import type { InsightsResponse } from '@fold/shared'
import { CalendarCheck, Flame, Repeat, ShoppingBag } from 'lucide-react'
import { useApi } from '../api'
import { useMe } from '../App'
import { fmtDate, fmtMoney, fmtMonthShort } from '../format'
import { MerchantLogo } from '../components/merchants'
import { Avatar, Card, CardTitle, EmptyState, cls } from '../ui'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Entity colors, dark-stepped via CSS vars (see index.css chart tokens). */
function memberColor(hex: string): string {
  return `var(--member-${hex.replace('#', '').toLowerCase()}, ${hex})`
}

/** Sequential accent ramp — one hue, light→dark, computed against the theme. */
function heatColor(level: number): string {
  if (level <= 0) return 'var(--color-slate-100)'
  const pct = [0, 25, 48, 72, 100][Math.min(4, level)]
  return `color-mix(in oklab, var(--color-accent) ${pct}%, var(--color-slate-100))`
}

const GROUP_SLOTS = 8

/* ---------------------------------------------------------------- tooltip -- */

interface TipState {
  x: number
  y: number
  lines: { key?: string; label: string; value: string }[]
  title?: string
}

function useTip() {
  const [tip, setTip] = useState<TipState | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  function show(e: { clientX: number; clientY: number }, next: Omit<TipState, 'x' | 'y'>): void {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, ...next })
  }
  return { tip, show, hide: () => setTip(null), ref }
}

function Tip({ tip }: { tip: TipState | null }) {
  if (!tip) return null
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: Math.max(4, tip.x - 60), top: Math.max(4, tip.y - 8), transform: 'translateY(-100%)' }}
    >
      {tip.title && <p className="mb-0.5 font-semibold text-slate-700">{tip.title}</p>}
      {tip.lines.map((line, i) => (
        <p key={i} className="flex items-center gap-1.5 whitespace-nowrap">
          {line.key && <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: line.key }} />}
          <span className="font-semibold tabular-nums text-slate-800">{line.value}</span>
          <span className="text-slate-500">{line.label}</span>
        </p>
      ))}
    </div>
  )
}

/** The WCAG-clean twin: every chart card can flip to its numbers. */
function AsTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-medium text-slate-400 hover:text-slate-600">
        See as a table
      </summary>
      <div className="mt-2 max-h-56 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400">
              {headers.map((h) => (
                <th key={h} className="py-1 pr-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className={cls('py-1 pr-3', j > 0 && 'tabular-nums')}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/* -------------------------------------------------------------- stat tiles -- */

function StatTile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <Card className="!py-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
    </Card>
  )
}

/* ----------------------------------------------------------------- heatmap -- */

function CalendarHeatmap({ data }: { data: InsightsResponse }) {
  const { tip, show, hide, ref } = useTip()
  const byDate = useMemo(() => new Map(data.daily.map((d) => [d.date, d])), [data.daily])

  // Last ~20 weeks, columns Sunday-first, ending on today's week.
  const weeks = useMemo(() => {
    const out: { date: string; total: number; count: number }[][] = []
    const end = new Date()
    end.setDate(end.getDate() + (6 - end.getDay()))
    const start = new Date(end)
    start.setDate(start.getDate() - 20 * 7 + 1)
    const cursor = new Date(start)
    let week: { date: string; total: number; count: number }[] = []
    const todayKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      const day = byDate.get(key)
      week.push({ date: key, total: key <= todayKey ? (day?.total_cents ?? 0) : -1, count: day?.count ?? 0 })
      if (week.length === 7) {
        out.push(week)
        week = []
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    return out
  }, [byDate])

  // Robust bins: scale to the 90th percentile so rent doesn't flatten everything.
  const p90 = useMemo(() => {
    const totals = data.daily.map((d) => d.total_cents).filter((t) => t > 0).sort((a, b) => a - b)
    return totals.length ? totals[Math.floor(totals.length * 0.9)] : 1
  }, [data.daily])
  const level = (total: number): number => {
    if (total <= 0) return 0
    const t = total / p90
    return t < 0.2 ? 1 : t < 0.5 ? 2 : t < 0.9 ? 3 : 4
  }

  const cell = 13
  const gap = 3
  const left = 30
  const top = 16
  const width = left + weeks.length * (cell + gap)
  const height = top + 7 * (cell + gap)

  const monthLabels: { x: number; label: string }[] = []
  let lastMonth = ''
  weeks.forEach((week, i) => {
    const month = week[0].date.slice(0, 7)
    if (month !== lastMonth) {
      monthLabels.push({ x: left + i * (cell + gap), label: fmtMonthShort(month) })
      lastMonth = month
    }
  })

  const weekTotals = weeks.map((week) => ({
    start: week[0].date,
    total: week.reduce((sum, d) => sum + Math.max(0, d.total), 0),
  }))

  return (
    <Card>
      <CardTitle>Spending heatmap</CardTitle>
      <p className="mb-2 text-xs text-slate-400">Every day of the last 20 weeks — darker means a heavier day.</p>
      <div ref={ref} className="relative overflow-x-auto pb-1">
        <svg width={width} height={height} className="block" role="img" aria-label="Daily spending heatmap">
          {monthLabels.map((m) => (
            <text key={m.x} x={m.x} y={10} className="fill-slate-400" fontSize="9">
              {m.label}
            </text>
          ))}
          {[1, 3, 5].map((dow) => (
            <text key={dow} x={0} y={top + dow * (cell + gap) + cell - 3} className="fill-slate-400" fontSize="9">
              {WEEKDAY_SHORT[dow]}
            </text>
          ))}
          {weeks.map((week, wi) =>
            week.map((day, di) =>
              day.total < 0 ? null : (
                <rect
                  key={day.date}
                  x={left + wi * (cell + gap)}
                  y={top + di * (cell + gap)}
                  width={cell}
                  height={cell}
                  rx={3}
                  fill={heatColor(level(day.total))}
                  onPointerMove={(e) =>
                    show(e, {
                      title: fmtDate(day.date),
                      lines: [
                        { label: 'spent', value: fmtMoney(day.total) },
                        { label: day.count === 1 ? 'purchase' : 'purchases', value: String(day.count) },
                      ],
                    })
                  }
                  onPointerLeave={hide}
                />
              ),
            ),
          )}
        </svg>
        <Tip tip={tip} />
      </div>
      <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-slate-400">
        less
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: heatColor(l) }} />
        ))}
        more
      </div>
      <AsTable
        headers={['Week of', 'Spent']}
        rows={weekTotals.map((w) => [fmtDate(w.start), fmtMoney(w.total)])}
      />
    </Card>
  )
}

/* ------------------------------------------------------------------- burn -- */

function BurnChart({ data }: { data: InsightsResponse }) {
  const { tip, show, hide, ref } = useTip()
  const [hoverDay, setHoverDay] = useState<number | null>(null)
  const { burn } = data
  const width = 640
  const height = 230
  const pad = { l: 46, r: 74, t: 12, b: 22 }
  const plotW = width - pad.l - pad.r
  const plotH = height - pad.t - pad.b

  const maxY = Math.max(
    burn.budget_cents,
    burn.this_month[burn.this_month.length - 1] ?? 0,
    burn.last_month[burn.last_month.length - 1] ?? 0,
    1,
  )
  const x = (day: number) => pad.l + ((day - 1) / (burn.days_in_month - 1)) * plotW
  const y = (cents: number) => pad.t + plotH - (cents / maxY) * plotH
  const path = (series: number[]) => series.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i + 1)},${y(v)}`).join(' ')

  const yTicks = useMemo(() => {
    const step = maxY > 600000 ? 200000 : maxY > 300000 ? 100000 : maxY > 120000 ? 50000 : 25000
    const ticks: number[] = []
    for (let v = step; v <= maxY; v += step) ticks.push(v)
    return ticks.slice(0, 5)
  }, [maxY])

  function onMove(e: React.PointerEvent<SVGSVGElement>): void {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * width
    const day = Math.max(1, Math.min(burn.days_in_month, Math.round(((px - pad.l) / plotW) * (burn.days_in_month - 1)) + 1))
    setHoverDay(day)
    const lines = [
      ...(day <= burn.this_month.length
        ? [{ key: 'var(--color-accent)', label: `by the ${day}th this month`, value: fmtMoney(burn.this_month[day - 1]) }]
        : []),
      ...(day <= burn.last_month.length
        ? [{ key: 'var(--color-slate-300)', label: 'same day last month', value: fmtMoney(burn.last_month[day - 1]) }]
        : []),
    ]
    show(e, { title: `Day ${day}`, lines })
  }

  const thisEnd = burn.this_month[burn.this_month.length - 1] ?? 0
  const lastEnd = burn.last_month[burn.last_month.length - 1] ?? 0

  return (
    <Card>
      <CardTitle>The burn</CardTitle>
      <p className="mb-2 text-xs text-slate-400">Cumulative spending through the month, against last month and the budget.</p>
      <div ref={ref} className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          onPointerMove={onMove}
          onPointerLeave={() => {
            hide()
            setHoverDay(null)
          }}
          role="img"
          aria-label="Cumulative spending this month versus last month"
>
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="var(--color-slate-100)" strokeWidth="1" />
              <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize="9" className="fill-slate-400">
                {`$${Math.round(v / 100000) > 0 ? `${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}k` : Math.round(v / 100)}`}
              </text>
            </g>
          ))}
          <line x1={pad.l} x2={width - pad.r} y1={pad.t + plotH} y2={pad.t + plotH} stroke="var(--color-slate-200)" strokeWidth="1" />
          {[1, 10, 20, burn.days_in_month].map((day) => (
            <text key={day} x={x(day)} y={height - 6} textAnchor="middle" fontSize="9" className="fill-slate-400">
              {day}
            </text>
          ))}
          {burn.budget_cents > 0 && (
            <g>
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={y(burn.budget_cents)}
                y2={y(burn.budget_cents)}
                stroke="var(--color-slate-300)"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
              <text x={width - pad.r + 6} y={y(burn.budget_cents) + 3} fontSize="9" className="fill-slate-400">
                budget
              </text>
            </g>
          )}
          {hoverDay != null && (
            <line x1={x(hoverDay)} x2={x(hoverDay)} y1={pad.t} y2={pad.t + plotH} stroke="var(--color-slate-300)" strokeWidth="1" />
          )}
          <path d={path(burn.last_month)} fill="none" stroke="var(--color-slate-300)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <path d={path(burn.this_month)} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(burn.this_month.length)} cy={y(thisEnd)} r="4" fill="var(--color-accent)" stroke="var(--color-white)" strokeWidth="2" />
          <text x={x(burn.this_month.length) + 7} y={y(thisEnd) + 3} fontSize="10" fontWeight="600" className="fill-slate-700">
            {fmtMoney(thisEnd, { whole: true })}
          </text>
          {burn.last_month.length > 0 && (
            <text x={width - pad.r + 6} y={y(lastEnd) + 3} fontSize="9" className="fill-slate-400">
              last mo
            </text>
          )}
        </svg>
        <Tip tip={tip} />
      </div>
      <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-[var(--color-accent)]" /> this month
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-slate-300" /> last month
        </span>
      </div>
      <AsTable
        headers={['Day', 'This month', 'Last month']}
        rows={Array.from({ length: burn.days_in_month }, (_, i) => [
          i + 1,
          i < burn.this_month.length ? fmtMoney(burn.this_month[i]) : '—',
          i < burn.last_month.length ? fmtMoney(burn.last_month[i]) : '—',
        ])}
      />
    </Card>
  )
}

/* ---------------------------------------------------------------- weekday -- */

function WeekdayBars({ data }: { data: InsightsResponse }) {
  const { tip, show, hide, ref } = useTip()
  const max = Math.max(...data.weekday_avg, 1)
  const busiest = data.habits.busiest_weekday
  const width = 320
  const height = 170
  const pad = { l: 8, r: 8, t: 26, b: 20 }
  const band = (width - pad.l - pad.r) / 7
  const barW = Math.min(24, band - 10)

  return (
    <Card>
      <CardTitle>Your week, on average</CardTitle>
      <p className="mb-2 text-xs text-slate-400">Average spend per day of the week over this window.</p>
      <div ref={ref} className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Average spending by weekday">
          <line x1={pad.l} x2={width - pad.r} y1={height - pad.b} y2={height - pad.b} stroke="var(--color-slate-200)" strokeWidth="1" />
          {data.weekday_avg.map((avg, dow) => {
            const h = ((height - pad.t - pad.b) * avg) / max
            const bx = pad.l + dow * band + (band - barW) / 2
            const by = height - pad.b - h
            return (
              <g key={dow}>
                <rect
                  x={pad.l + dow * band}
                  y={pad.t - 14}
                  width={band}
                  height={height - pad.t - pad.b + 14}
                  fill="transparent"
                  onPointerMove={(e) => show(e, { title: WEEKDAYS[dow], lines: [{ label: 'avg spend', value: fmtMoney(avg) }] })}
                  onPointerLeave={hide}
                />
                <path
                  d={`M${bx},${height - pad.b} L${bx},${by + 4} Q${bx},${by} ${bx + 4},${by} L${bx + barW - 4},${by} Q${bx + barW},${by} ${bx + barW},${by + 4} L${bx + barW},${height - pad.b} Z`}
                  fill="var(--color-accent)"
                  opacity={dow === busiest ? 1 : 0.55}
                  pointerEvents="none"
                />
                {dow === busiest && avg > 0 && (
                  <text x={bx + barW / 2} y={by - 5} textAnchor="middle" fontSize="9" fontWeight="600" className="fill-slate-700">
                    {fmtMoney(avg, { whole: true })}
                  </text>
                )}
                <text x={pad.l + dow * band + band / 2} y={height - 6} textAnchor="middle" fontSize="9" className="fill-slate-400">
                  {WEEKDAY_SHORT[dow]}
                </text>
              </g>
            )
          })}
        </svg>
        <Tip tip={tip} />
      </div>
      <AsTable headers={['Day', 'Average']} rows={data.weekday_avg.map((avg, dow) => [WEEKDAYS[dow], fmtMoney(avg)])} />
    </Card>
  )
}

/* ------------------------------------------------------------------- flow -- */

function FlowChart({ data }: { data: InsightsResponse }) {
  const { me } = useMe()
  const { tip, show, hide, ref } = useTip()
  const members = data.flow.members.filter((m) => m.income_cents > 0 || m.shared_cents > 0 || m.personal_cents > 0)
  if (members.length === 0) return null

  interface Target {
    key: string
    label: string
    color: string
    parts: { member: (typeof members)[number]; cents: number }[]
  }
  const targets: Target[] = [
    {
      key: 'shared',
      label: 'Shared spending',
      color: 'var(--color-accent)',
      parts: members.map((m) => ({ member: m, cents: m.shared_cents })),
    },
    ...members.map((m) => ({
      key: `personal-${m.user_id}`,
      label: `${m.name.split(' ')[0]}’s personal`,
      color: memberColor(m.color),
      parts: [{ member: m, cents: m.personal_cents }],
    })),
    {
      key: 'kept',
      label: 'Kept',
      color: 'var(--viz-other)',
      parts: members.map((m) => ({ member: m, cents: Math.max(0, m.kept_cents) })),
    },
  ].filter((t) => t.parts.some((p) => p.cents > 0))

  const width = 640
  const height = 300
  const nodeW = 10
  const leftX = 150
  const rightX = width - 190
  const gapY = 14
  const totalIn = members.reduce((sum, m) => sum + Math.max(m.income_cents, m.shared_cents + m.personal_cents), 0)
  const scale = (height - gapY * (Math.max(members.length, targets.length) + 1)) / Math.max(totalIn, 1)

  // Left node positions.
  let cursorY = gapY
  const leftNodes = members.map((m) => {
    const h = Math.max(6, Math.max(m.income_cents, m.shared_cents + m.personal_cents) * scale)
    const node = { member: m, y: cursorY, h }
    cursorY += h + gapY
    return node
  })
  // Right node positions.
  const rightTotal = targets.reduce((sum, t) => sum + t.parts.reduce((s, p) => s + p.cents, 0), 0)
  const rightScale = (height - gapY * (targets.length + 1)) / Math.max(rightTotal, 1)
  cursorY = gapY
  const rightNodes = targets.map((t) => {
    const total = t.parts.reduce((s, p) => s + p.cents, 0)
    const h = Math.max(6, total * rightScale)
    const node = { target: t, total, y: cursorY, h }
    cursorY += h + gapY
    return node
  })

  // Ribbons: member → target, stacked offsets on both ends.
  const leftOffsets = new Map(leftNodes.map((n) => [n.member.user_id, n.y]))
  const ribbons: { from: string; color: string; label: string; cents: number; d: string }[] = []
  for (const rightNode of rightNodes) {
    let ry = rightNode.y
    for (const part of rightNode.target.parts) {
      if (part.cents <= 0) continue
      const h = Math.max(2, part.cents * rightScale)
      const ly = leftOffsets.get(part.member.user_id) ?? gapY
      const lh = Math.max(2, part.cents * scale)
      leftOffsets.set(part.member.user_id, ly + lh)
      const mid = (leftX + nodeW + rightX) / 2
      ribbons.push({
        from: part.member.user_id,
        color: memberColor(part.member.color),
        label: `${part.member.name.split(' ')[0]} → ${rightNode.target.label}`,
        cents: part.cents,
        d: `M${leftX + nodeW},${ly} C${mid},${ly} ${mid},${ry} ${rightX},${ry} L${rightX},${ry + h} C${mid},${ry + h} ${mid},${ly + lh} ${leftX + nodeW},${ly + lh} Z`,
      })
      ry += h
    }
  }

  return (
    <Card>
      <CardTitle>Where {fmtMonthShort(data.flow.month)}’s money flows</CardTitle>
      <p className="mb-2 text-xs text-slate-400">
        Each person’s income into shared spending, their own personal spending, and what’s kept.
      </p>
      <div ref={ref} className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Money flow from income to spending">
          {ribbons.map((ribbon, i) => (
            <path
              key={i}
              d={ribbon.d}
              fill={ribbon.color}
              opacity="0.45"
              onPointerMove={(e) => show(e, { lines: [{ key: ribbon.color, label: ribbon.label, value: fmtMoney(ribbon.cents) }] })}
              onPointerLeave={hide}
            />
          ))}
          {leftNodes.map((node) => (
            <g key={node.member.user_id}>
              <rect x={leftX} y={node.y} width={nodeW} height={node.h} rx="3" fill={memberColor(node.member.color)} />
              <text x={leftX - 8} y={node.y + node.h / 2 - 2} textAnchor="end" fontSize="11" fontWeight="600" className="fill-slate-700">
                {node.member.name.split(' ')[0]}
              </text>
              <text x={leftX - 8} y={node.y + node.h / 2 + 10} textAnchor="end" fontSize="9" className="fill-slate-400">
                {node.member.income_cents > 0 ? fmtMoney(node.member.income_cents, { whole: true }) : 'no income set'}
              </text>
            </g>
          ))}
          {rightNodes.map((node) =>
            node.h < 26 ? (
              // Short nodes get one line so neighboring labels can't collide.
              <g key={node.target.key}>
                <rect x={rightX} y={node.y} width={nodeW} height={node.h} rx="3" fill={node.target.color} />
                <text x={rightX + nodeW + 8} y={node.y + node.h / 2 + 4} fontSize="11" fontWeight="600" className="fill-slate-700">
                  {node.target.label}
                  <tspan fontSize="9" fontWeight="400" className="fill-slate-400">
                    {'  '}{fmtMoney(node.total, { whole: true })}
                  </tspan>
                </text>
              </g>
            ) : (
              <g key={node.target.key}>
                <rect x={rightX} y={node.y} width={nodeW} height={node.h} rx="3" fill={node.target.color} />
                <text x={rightX + nodeW + 8} y={node.y + node.h / 2 - 2} fontSize="11" fontWeight="600" className="fill-slate-700">
                  {node.target.label}
                </text>
                <text x={rightX + nodeW + 8} y={node.y + node.h / 2 + 10} fontSize="9" className="fill-slate-400">
                  {fmtMoney(node.total, { whole: true })}
                </text>
              </g>
            ),
          )}
        </svg>
        <Tip tip={tip} />
      </div>
      {members.some((m) => m.kept_cents < 0) && (
        <p className="mt-1 text-xs text-amber-600">
          {members
            .filter((m) => m.kept_cents < 0)
            .map((m) => `${m.name.split(' ')[0]} spent ${fmtMoney(-m.kept_cents)} more than their income this month`)
            .join(' · ')}
        </p>
      )}
      <AsTable
        headers={['Person', 'Income', 'Shared', 'Personal', 'Kept']}
        rows={members.map((m) => [
          m.name,
          fmtMoney(m.income_cents),
          fmtMoney(m.shared_cents),
          fmtMoney(m.personal_cents),
          fmtMoney(m.kept_cents),
        ])}
      />
      <p className="mt-2 text-xs text-slate-400">
        Exact envelope math lives on the <Link to="/budget" className="underline">Budget page</Link> — this is the shape of the month.
      </p>
    </Card>
  )
}

/* ---------------------------------------------------------------- treemap -- */

interface TreeRect {
  x: number
  y: number
  w: number
  h: number
  name: string
  emoji: string | null
  group: string
  total: number
}

/** Squarified treemap layout (Bruls et al.) — rows of near-square cells. */
function squarify(items: { name: string; emoji: string | null; group: string; total: number }[], width: number, height: number): TreeRect[] {
  const total = items.reduce((sum, item) => sum + item.total, 0)
  if (total <= 0) return []
  const scaled = items.map((item) => ({ ...item, area: (item.total / total) * width * height }))
  const rects: TreeRect[] = []
  let x = 0
  let y = 0
  let w = width
  let h = height
  let row: typeof scaled = []

  const worst = (candidate: typeof scaled, side: number): number => {
    const sum = candidate.reduce((s, r) => s + r.area, 0)
    const max = Math.max(...candidate.map((r) => r.area))
    const min = Math.min(...candidate.map((r) => r.area))
    const s2 = sum * sum
    return Math.max((side * side * max) / s2, s2 / (side * side * min))
  }
  const layoutRow = (): void => {
    const sum = row.reduce((s, r) => s + r.area, 0)
    const horizontal = w >= h
    const side = horizontal ? h : w
    const thickness = sum / side
    let offset = 0
    for (const item of row) {
      const length = item.area / thickness
      rects.push(
        horizontal
          ? { x, y: y + offset, w: thickness, h: length, name: item.name, emoji: item.emoji, group: item.group, total: item.total }
          : { x: x + offset, y, w: length, h: thickness, name: item.name, emoji: item.emoji, group: item.group, total: item.total },
      )
      offset += length
    }
    if (horizontal) {
      x += thickness
      w -= thickness
    } else {
      y += thickness
      h -= thickness
    }
    row = []
  }

  for (const item of scaled) {
    const side = Math.min(w, h)
    if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) {
      row.push(item)
    } else {
      layoutRow()
      row.push(item)
    }
  }
  if (row.length > 0) layoutRow()
  return rects
}

function Treemap({ data }: { data: InsightsResponse }) {
  const { tip, show, hide, ref } = useTip()
  const items = useMemo(() => {
    const sorted = [...data.treemap].sort((a, b) => b.total_cents - a.total_cents)
    const keep = sorted.slice(0, 17)
    const rest = sorted.slice(17)
    if (rest.length > 0) {
      keep.push({
        category_id: 'other',
        name: `${rest.length} smaller`,
        emoji: null,
        group: 'Other',
        total_cents: rest.reduce((sum, r) => sum + r.total_cents, 0),
      })
    }
    return keep.map((item) => ({ name: item.name, emoji: item.emoji, group: item.group, total: item.total_cents }))
  }, [data.treemap])

  // Server order is deterministic (budget sort → personal → catch-alls), so a
  // group keeps its color no matter which time window is picked.
  const groups = useMemo(() => {
    const seen = new Map<string, number>()
    for (const item of data.treemap) {
      seen.set(item.group, (seen.get(item.group) ?? 0) + item.total_cents)
    }
    return [...seen.entries()].map(([name, total]) => ({ name, total }))
  }, [data.treemap])

  const slotByGroup = useMemo(() => {
    const map = new Map<string, string>()
    let slot = 0
    groups.forEach((group) => {
      if (group.name === 'Uncategorized' || group.name === 'Other' || slot >= GROUP_SLOTS) {
        map.set(group.name, 'var(--viz-other)')
      } else {
        slot += 1
        map.set(group.name, `var(--viz-${slot})`)
      }
    })
    return map
  }, [groups])

  const width = 640
  const height = 330
  const rects = useMemo(() => squarify(items, width, height), [items])
  const grand = items.reduce((sum, item) => sum + item.total, 0)

  if (rects.length === 0) return null
  return (
    <Card>
      <CardTitle>Every dollar, to scale</CardTitle>
      <p className="mb-2 text-xs text-slate-400">
        {fmtMoney(grand)} over this window — each tile is a category, colored by its group.
      </p>
      <div ref={ref} className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Spending by category, sized proportionally">
          {rects.map((rect) => {
            const showLabel = rect.w > 78 && rect.h > 34
            const showValue = rect.w > 78 && rect.h > 52
            return (
              <g key={`${rect.name}-${rect.x}-${rect.y}`}>
                <rect
                  x={rect.x + 1}
                  y={rect.y + 1}
                  width={Math.max(1, rect.w - 2)}
                  height={Math.max(1, rect.h - 2)}
                  rx="4"
                  fill={slotByGroup.get(rect.group) ?? 'var(--viz-other)'}
                  onPointerMove={(e) =>
                    show(e, {
                      title: `${rect.emoji ?? ''} ${rect.name}`.trim(),
                      lines: [
                        { label: rect.group, value: fmtMoney(rect.total) },
                        { label: 'of the window total', value: `${Math.round((rect.total / grand) * 100)}%` },
                      ],
                    })
                  }
                  onPointerLeave={hide}
                />
                {showLabel && (
                  <text x={rect.x + 8} y={rect.y + 18} fontSize="10.5" fontWeight="600" fill="#fff" pointerEvents="none">
                    {rect.emoji ? `${rect.emoji} ` : ''}
                    {rect.name.length > (rect.w - (rect.emoji ? 36 : 20)) / 6.5
                      ? `${rect.name.slice(0, Math.max(3, Math.floor((rect.w - (rect.emoji ? 36 : 20)) / 6.5)))}…`
                      : rect.name}
                  </text>
                )}
                {showValue && (
                  <text x={rect.x + 8} y={rect.y + 32} fontSize="9.5" fill="#fff" opacity="0.85" pointerEvents="none">
                    {fmtMoney(rect.total, { whole: true })}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        <Tip tip={tip} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {groups.map((group) => (
          <span key={group.name} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: slotByGroup.get(group.name) }} />
            {group.name}
            <span className="tabular-nums text-slate-400">{fmtMoney(group.total, { whole: true })}</span>
          </span>
        ))}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------- top stores -- */

function TopStores({ data }: { data: InsightsResponse }) {
  if (data.merchants.length === 0) return null
  const max = data.merchants[0].total_cents
  return (
    <Card>
      <CardTitle>Where you keep going back</CardTitle>
      <p className="mb-2 text-xs text-slate-400">Top stores across this window.</p>
      <ul className="space-y-2.5">
        {data.merchants.map((store) => (
          <li key={store.id} className="flex items-center gap-3">
            <MerchantLogo name={store.name} domain={store.domain} size={28} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{store.name}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{fmtMoney(store.total_cents)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: 'color-mix(in oklab, var(--color-accent) 12%, var(--color-slate-100))' }}>
                  <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${(store.total_cents / max) * 100}%` }} />
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                  {store.visits} {store.visits === 1 ? 'visit' : 'visits'}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* -------------------------------------------------------------- sparklines -- */

function SparkGrid({ data }: { data: InsightsResponse }) {
  if (data.sparklines.length === 0) return null
  return (
    <Card>
      <CardTitle>Category habits</CardTitle>
      <p className="mb-3 text-xs text-slate-400">Six months of each envelope, at a glance. The dot is this month.</p>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
        {data.sparklines.map((spark) => {
          const max = Math.max(...spark.months, 1)
          const w = 120
          const h = 34
          const px = (i: number) => 4 + (i / (spark.months.length - 1)) * (w - 8)
          const points = spark.months.map((v, i) => `${px(i)},${h - 4 - (v / max) * (h - 8)}`)
          const current = spark.months[spark.months.length - 1]
          const prev = spark.months[spark.months.length - 2] ?? 0
          const delta = current - prev
          return (
            <div key={spark.category_id}>
              <p className="truncate text-xs font-medium text-slate-600">
                {spark.emoji ? `${spark.emoji} ` : ''}
                {spark.name}
              </p>
              <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 w-full" role="img" aria-label={`${spark.name} monthly spending trend`}>
                <polyline points={points.join(' ')} fill="none" stroke="var(--color-slate-200)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <polyline points={points.slice(-2).join(' ')} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" />
                <circle cx={px(spark.months.length - 1)} cy={h - 4 - (current / max) * (h - 8)} r="3.5" fill="var(--color-accent)" stroke="var(--color-white)" strokeWidth="2" />
              </svg>
              <p className="mt-0.5 text-xs tabular-nums text-slate-500">
                {fmtMoney(current, { whole: true })}
                {delta !== 0 && (
                  <span className={cls('ml-1.5', delta < 0 ? 'text-emerald-600' : 'text-slate-400')}>
                    {delta < 0 ? '▾' : '▴'} {fmtMoney(Math.abs(delta), { whole: true })}
                  </span>
                )}
              </p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ page -- */

export default function Insights() {
  const [months, setMonths] = useState(6)
  // useApi holds the previous payload while a new window loads — the charts
  // keep their frame at reduced opacity instead of flashing away.
  const { data: view, loading } = useApi<InsightsResponse>(`/insights?months=${months}`)

  if (!view) return null
  const empty = view.daily.length === 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Insights</h1>
          <p className="text-sm text-slate-500">Your habits, patterns, and where the money actually goes.</p>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-1 text-sm font-medium">
          {([3, 6, 12] as const).map((value) => (
            <button
              key={value}
              onClick={() => setMonths(value)}
              className={cls('rounded-lg px-3 py-1.5', months === value ? 'bg-white shadow-sm' : 'text-slate-500')}
            >
              {value} months
            </button>
          ))}
        </div>
      </div>

      {empty ? (
        <EmptyState emoji="🔭" title="Nothing to see yet">
          Add or import some spending and this page starts finding your patterns.
        </EmptyState>
      ) : (
        <div className={cls('space-y-5 transition-opacity', loading && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              icon={<Flame size={13} />}
              label="No-spend days"
              value={`${view.habits.no_spend_days_30} of 30`}
              hint={`Longest streak: ${view.habits.longest_no_spend_streak_30} day${view.habits.longest_no_spend_streak_30 === 1 ? '' : 's'}`}
            />
            <StatTile
              icon={<CalendarCheck size={13} />}
              label="Biggest day"
              value={WEEKDAYS[view.habits.busiest_weekday]}
              hint={`${view.habits.weekend_share_pct}% of spending lands on weekends`}
            />
            <StatTile
              icon={<Repeat size={13} />}
              label="On autopilot"
              value={`${view.habits.autopilot_share_pct}%`}
              hint="Recurring bills as a share of spending"
            />
            <StatTile
              icon={<ShoppingBag size={13} />}
              label="Typical purchase"
              value={fmtMoney(view.habits.avg_purchase_cents, { whole: true })}
              hint={`${view.habits.tx_per_week} purchases a week`}
            />
          </div>

          <CalendarHeatmap data={view} />

          <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
            <BurnChart data={view} />
            <WeekdayBars data={view} />
          </div>

          <FlowChart data={view} />
          <Treemap data={view} />

          <div className="grid gap-5 lg:grid-cols-2">
            <TopStores data={view} />
            <SparkGrid data={view} />
          </div>
        </div>
      )}
    </div>
  )
}
