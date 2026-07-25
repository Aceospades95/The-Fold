const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

export function fmtMoney(cents: number, opts?: { whole?: boolean }): string {
  const fmt = opts?.whole && cents % 100 === 0 ? usdWhole : usd
  return fmt.format(cents / 100)
}

/** Parse a user-typed dollar amount ("1,234.56", "$40") into integer cents. Null if invalid. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '')
  if (cleaned === '' || !/^-?\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '-' || cleaned === '.') {
    return null
  }
  const value = Number.parseFloat(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return ''
  return (cents / 100).toFixed(2)
}
