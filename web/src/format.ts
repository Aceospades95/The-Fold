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

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
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
