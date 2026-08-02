import { addDays } from './util.js'

export interface IcsEvent {
  uid: string
  title: string
  /** YYYY-MM-DD (all-day) */
  start: string
  /** YYYY-MM-DD inclusive end; defaults to start */
  end?: string
  description?: string
  location?: string
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

function dateValue(date: string): string {
  return date.replace(/-/g, '')
}

export function buildIcs(calendarName: string, events: IcsEvent[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Fold//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ]
  for (const event of events) {
    const endExclusive = addDays(event.end ?? event.start, 1)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}@the-fold`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateValue(event.start)}`,
      `DTEND;VALUE=DATE:${dateValue(endExclusive)}`,
      `SUMMARY:${escapeText(event.title)}`,
    )
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
