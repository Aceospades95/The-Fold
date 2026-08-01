import { randomUUID } from 'node:crypto'

export function id(): string {
  return randomUUID()
}

export const MEMBER_COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#3b82f6']

export function now(): string {
  return new Date().toISOString()
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function currentMonth(): string {
  return today().slice(0, 7)
}

/** [start, end) date range for a YYYY-MM month. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  return { start, end }
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7)
}

/** Whole months from `from` to `to` (negative when `to` is earlier). */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

export function monthList(from: string, to: string): string[] {
  const months: string[] = []
  for (let cursor = from; cursor <= to; cursor = shiftMonth(cursor, 1)) {
    months.push(cursor)
    if (months.length > 600) break
  }
  return months
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export class HttpError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

export function notFound(what = 'Resource'): never {
  throw new HttpError(404, `${what} not found`)
}

export function badRequest(message: string): never {
  throw new HttpError(400, message)
}
