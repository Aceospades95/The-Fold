export { fmtMoney, parseMoney, centsToInput } from '@fold/shared'

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const shortDateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const fullDateFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

const monthShortFmt = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })

export function fmtMonth(month: string): string {
  return monthFmt.format(new Date(`${month}-01T00:00:00Z`))
}

export function fmtMonthShort(month: string): string {
  return monthShortFmt.format(new Date(`${month}-01T00:00:00Z`))
}

export function fmtDate(date: string): string {
  return shortDateFmt.format(new Date(`${date}T00:00:00Z`))
}

export function fmtDateFull(date: string): string {
  return fullDateFmt.format(new Date(`${date}T00:00:00Z`))
}

export function fmtRange(start: string | null, end: string | null): string {
  if (!start) return 'Dates TBD'
  if (!end || end === start) return fmtDate(start)
  return `${fmtDate(start)} – ${fmtDate(end)}`
}

/** Today in the user's local timezone (an evening entry must not land on tomorrow's UTC date). */
export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysFromToday(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayStr()}T00:00:00Z`)) / 86_400_000)
}

/** "Today", "Yesterday", "Tomorrow", otherwise the short date. */
export function fmtDay(date: string): string {
  const delta = daysFromToday(date)
  if (delta === 0) return 'Today'
  if (delta === -1) return 'Yesterday'
  if (delta === 1) return 'Tomorrow'
  return fmtDate(date)
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later'

/** How a due date should read and how loudly: overdue is red, today is amber, this week is neutral-strong. */
export function dueLabel(date: string): { text: string; tone: DueTone; days: number } {
  const days = daysFromToday(date)
  if (days < 0) return { text: days === -1 ? 'Yesterday' : `${-days} days overdue`, tone: 'overdue', days }
  if (days === 0) return { text: 'Today', tone: 'today', days }
  if (days === 1) return { text: 'Tomorrow', tone: 'soon', days }
  if (days <= 6) return { text: fmtDateFull(date).split(',')[0], tone: 'soon', days }
  return { text: fmtDate(date), tone: 'later', days }
}

export const DUE_TONE_CLASS: Record<DueTone, string> = {
  overdue: 'text-red-600 font-medium',
  today: 'text-amber-600 font-medium',
  soon: 'text-slate-600',
  later: 'text-slate-500',
}

export function currentMonth(): string {
  return todayStr().slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + delta, 1))
  return date.toISOString().slice(0, 7)
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
