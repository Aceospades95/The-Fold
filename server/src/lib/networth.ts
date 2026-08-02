import type { DatabaseSync } from 'node:sqlite'
import type { AccountRow, AccountType, NetWorthPoint, NetWorthResponse } from '@fold/shared'
import { LIABILITY_TYPES } from '@fold/shared'

function sign(type: AccountType): number {
  return LIABILITY_TYPES.includes(type) ? -1 : 1
}

export function computeNetWorth(db: DatabaseSync, householdId: string): NetWorthResponse {
  const accounts = db
    .prepare(
      `SELECT a.id, a.name, a.type, a.owner_user_id, a.archived, a.sort,
              (SELECT s.balance_cents FROM account_snapshots s WHERE s.account_id = a.id ORDER BY s.date DESC LIMIT 1) AS balance_cents,
              (SELECT s.date FROM account_snapshots s WHERE s.account_id = a.id ORDER BY s.date DESC LIMIT 1) AS balance_date
       FROM accounts a WHERE a.household_id = ? AND a.archived = 0 ORDER BY a.sort, a.name`,
    )
    .all(householdId) as unknown as (AccountRow & { balance_cents: number | null })[]

  const withBalances: AccountRow[] = accounts.map((a) => ({ ...a, balance_cents: a.balance_cents ?? 0 }))

  const snapshots = db
    .prepare(
      `SELECT s.account_id, s.date, s.balance_cents, a.type
       FROM account_snapshots s JOIN accounts a ON a.id = s.account_id
       WHERE a.household_id = ? AND a.archived = 0 ORDER BY s.date`,
    )
    .all(householdId) as { account_id: string; date: string; balance_cents: number; type: AccountType }[]

  // Month-end series: carry each account's last known balance forward.
  const months = [...new Set(snapshots.map((s) => s.date.slice(0, 7)))].sort()
  const history: NetWorthPoint[] = []
  const latest = new Map<string, { balance: number; type: AccountType }>()
  let snapshotIndex = 0
  for (const month of months) {
    while (snapshotIndex < snapshots.length && snapshots[snapshotIndex].date.slice(0, 7) <= month) {
      const snap = snapshots[snapshotIndex]
      latest.set(snap.account_id, { balance: snap.balance_cents, type: snap.type })
      snapshotIndex += 1
    }
    let assets = 0
    let liabilities = 0
    for (const { balance, type } of latest.values()) {
      if (sign(type) > 0) assets += balance
      else liabilities += balance
    }
    history.push({ month, assets_cents: assets, liabilities_cents: liabilities, net_cents: assets - liabilities })
  }

  const assets_cents = withBalances.filter((a) => sign(a.type) > 0).reduce((sum, a) => sum + a.balance_cents, 0)
  const liabilities_cents = withBalances.filter((a) => sign(a.type) < 0).reduce((sum, a) => sum + a.balance_cents, 0)
  const net_cents = assets_cents - liabilities_cents
  const previous = history.length >= 2 ? history[history.length - 2] : null

  return {
    accounts: withBalances,
    history,
    assets_cents,
    liabilities_cents,
    net_cents,
    delta_month_cents: previous ? net_cents - previous.net_cents : null,
  }
}
