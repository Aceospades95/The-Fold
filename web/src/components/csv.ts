/** Minimal RFC-4180-ish CSV parser: quotes, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

/** Accepts 2026-07-04, 07/04/2026, 7/4/26 → YYYY-MM-DD (null if unparseable). */
export function parseCsvDate(value: string): string | null {
  const trimmed = value.trim()
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3]
    return `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  }
  return null
}

/** "-$1,234.56", "(45.00)", "12.30" → signed cents (null if unparseable). */
export function parseCsvAmount(value: string): number | null {
  let trimmed = value.trim()
  let negative = false
  if (/^\(.*\)$/.test(trimmed)) {
    negative = true
    trimmed = trimmed.slice(1, -1)
  }
  trimmed = trimmed.replace(/[$,\s]/g, '')
  if (trimmed.startsWith('-')) {
    negative = true
    trimmed = trimmed.slice(1)
  }
  if (!/^\d*(\.\d+)?$/.test(trimmed) || trimmed === '' || trimmed === '.') return null
  const cents = Math.round(Number.parseFloat(trimmed) * 100)
  return negative ? -cents : cents
}

export function guessColumn(headers: string[], candidates: string[]): number {
  const lowered = headers.map((h) => h.toLowerCase())
  for (const candidate of candidates) {
    const index = lowered.findIndex((h) => h.includes(candidate))
    if (index !== -1) return index
  }
  return -1
}
