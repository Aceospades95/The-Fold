import type { Cadence } from './types.js'

export const CADENCES: { value: Cadence; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'annual', label: 'Yearly' },
]

/** Normalize a paycheck cadence to an average monthly amount in cents. */
export function monthlyCents(amountCents: number, cadence: Cadence): number {
  switch (cadence) {
    case 'monthly':
      return amountCents
    case 'semimonthly':
      return amountCents * 2
    case 'biweekly':
      return Math.round((amountCents * 26) / 12)
    case 'weekly':
      return Math.round((amountCents * 52) / 12)
    case 'annual':
      return Math.round(amountCents / 12)
  }
}
