import type { DatabaseSync } from 'node:sqlite'
import type { DuplicatePair } from '@fold/shared'
import { getSetting } from './webhooks.js'

/** Share of meaningful words two descriptions have in common (0–1). */
export function tokenSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 2))
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const token of ta) if (tb.has(token)) shared += 1
  return shared / Math.min(ta.size, tb.size)
}

interface CandidateRow {
  a_id: string
  a_date: string
  a_desc: string
  amount: number
  a_payer: string
  a_hash: string | null
  b_id: string
  b_date: string
  b_desc: string
  b_payer: string
  b_hash: string | null
}

/** Existing lookalikes: same amount, ≤3 days apart, plausible pair, not yet dismissed. */
export function findDuplicatePairs(db: DatabaseSync, householdId: string): DuplicatePair[] {
  const dismissed = new Set(getSetting<string[]>(db, householdId, 'dup_dismissed') ?? [])
  const candidates = db
    .prepare(
      `SELECT a.id AS a_id, a.date AS a_date, a.description AS a_desc, a.amount_cents AS amount,
              a.payer_user_id AS a_payer, a.import_hash AS a_hash,
              b.id AS b_id, b.date AS b_date, b.description AS b_desc,
              b.payer_user_id AS b_payer, b.import_hash AS b_hash
       FROM transactions a
       JOIN transactions b
         ON b.household_id = a.household_id AND b.kind = 'expense'
        AND b.amount_cents = a.amount_cents AND b.id > a.id
        AND abs(julianday(b.date) - julianday(a.date)) <= 3
       WHERE a.household_id = ? AND a.kind = 'expense' AND a.amount_cents > 0
       LIMIT 200`,
    )
    .all(householdId) as unknown as CandidateRow[]

  return candidates
    .filter((c) => !dismissed.has([c.a_id, c.b_id].sort().join(':')))
    // Two imported rows with distinct hashes are usually genuinely separate
    // charges — only pair them when the descriptions clearly agree.
    .filter((c) => c.a_hash == null || c.b_hash == null || tokenSimilarity(c.a_desc, c.b_desc) >= 0.5)
    .slice(0, 25)
    .map((c) => ({
      a: { id: c.a_id, date: c.a_date, description: c.a_desc, amount_cents: c.amount, payer_user_id: c.a_payer, imported: c.a_hash != null },
      b: { id: c.b_id, date: c.b_date, description: c.b_desc, amount_cents: c.amount, payer_user_id: c.b_payer, imported: c.b_hash != null },
    }))
}
