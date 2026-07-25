import type { Split } from './types.js'

/**
 * Split an amount across users by integer weights, distributing leftover cents
 * to the earliest users so the shares always sum exactly to the amount.
 */
export function splitByWeights(amountCents: number, weights: { user_id: string; weight: number }[]): Split[] {
  const total = weights.reduce((sum, w) => sum + w.weight, 0)
  const effective = total > 0 ? weights : weights.map((w) => ({ ...w, weight: 1 }))
  const effectiveTotal = total > 0 ? total : weights.length
  const shares = effective.map((w) => ({
    user_id: w.user_id,
    share_cents: Math.floor((amountCents * w.weight) / effectiveTotal),
  }))
  let leftover = amountCents - shares.reduce((sum, s) => sum + s.share_cents, 0)
  for (let i = 0; leftover > 0; i = (i + 1) % shares.length) {
    shares[i].share_cents += 1
    leftover -= 1
  }
  return shares
}

export function splitEqual(amountCents: number, userIds: string[]): Split[] {
  return splitByWeights(
    amountCents,
    userIds.map((user_id) => ({ user_id, weight: 1 })),
  )
}
