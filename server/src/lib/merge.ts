import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { HttpError, MEMBER_COLORS, badRequest, now } from './util.js'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const MAX_MEMBERS = 4
const INVITE_DAYS = 14

export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function formatInviteCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

export function createInvite(
  db: DatabaseSync,
  householdId: string,
  createdBy: string,
): { code: string; expires_at: string } {
  const members = (
    db.prepare('SELECT COUNT(*) AS c FROM users WHERE household_id = ?').get(householdId) as { c: number }
  ).c
  if (members >= MAX_MEMBERS) badRequest('This household is full.')
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[randomBytes(1)[0] % CODE_ALPHABET.length]
  }
  const expires = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  db.prepare(
    'INSERT INTO invites (code, household_id, created_by_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(code, householdId, createdBy, now(), expires)
  return { code: formatInviteCode(code), expires_at: expires }
}

interface InviteRow {
  code: string
  household_id: string
  expires_at: string
  used_by_user_id: string | null
}

function validateInvite(db: DatabaseSync, rawCode: string): InviteRow {
  const code = normalizeInviteCode(rawCode)
  const invite = db
    .prepare('SELECT code, household_id, expires_at, used_by_user_id FROM invites WHERE code = ?')
    .get(code) as InviteRow | undefined
  if (!invite) throw new HttpError(400, 'That invite code doesn’t exist — double-check it.')
  if (invite.used_by_user_id) throw new HttpError(400, 'That invite code was already used.')
  if (invite.expires_at < now()) throw new HttpError(400, 'That invite code has expired — ask for a fresh one.')
  const members = (
    db.prepare('SELECT COUNT(*) AS c FROM users WHERE household_id = ?').get(invite.household_id) as { c: number }
  ).c
  if (members >= MAX_MEMBERS) throw new HttpError(400, 'That household is full.')
  return invite
}

/**
 * Fold a solo user's household into the target household. Their categories
 * become personal envelopes (their solo "shared" was really just theirs);
 * untouched starter content is dropped instead of duplicated; transactions,
 * allocations, accounts, trips, and non-empty lists all come along.
 */
function mergeHouseholds(db: DatabaseSync, userId: string, targetHouseholdId: string): void {
  const user = db.prepare('SELECT household_id FROM users WHERE id = ?').get(userId) as
    | { household_id: string }
    | undefined
  if (!user) badRequest('Unknown user.')
  const oldHouseholdId = user!.household_id
  if (oldHouseholdId === targetHouseholdId) badRequest('You’re already part of that household.')
  const oldMembers = (
    db.prepare('SELECT COUNT(*) AS c FROM users WHERE household_id = ?').get(oldHouseholdId) as { c: number }
  ).c
  if (oldMembers > 1) {
    badRequest('Your budget already has more than one person — invites can only link a solo budget.')
  }

  db.exec('BEGIN')
  try {
    const categories = db
      .prepare('SELECT id FROM categories WHERE household_id = ?')
      .all(oldHouseholdId) as { id: string }[]
    for (const category of categories) {
      const active = db
        .prepare(
          `SELECT EXISTS (SELECT 1 FROM transaction_lines WHERE category_id = ?)
               OR EXISTS (SELECT 1 FROM allocations WHERE category_id = ? AND amount_cents > 0) AS used`,
        )
        .get(category.id, category.id) as { used: number }
      if (active.used) {
        db.prepare(
          `UPDATE categories SET household_id = ?, scope = 'personal', owner_user_id = ?, group_id = NULL WHERE id = ?`,
        ).run(targetHouseholdId, userId, category.id)
      } else {
        db.prepare('DELETE FROM categories WHERE id = ?').run(category.id)
      }
    }
    db.prepare('DELETE FROM category_groups WHERE household_id = ?').run(oldHouseholdId)

    for (const table of ['transactions', 'recurring_transactions', 'import_rules', 'accounts', 'trips', 'api_tokens']) {
      db.prepare(`UPDATE ${table} SET household_id = ? WHERE household_id = ?`).run(targetHouseholdId, oldHouseholdId)
    }
    db.prepare('UPDATE month_incomes SET household_id = ? WHERE household_id = ?').run(
      targetHouseholdId,
      oldHouseholdId,
    )

    const lists = db.prepare('SELECT id FROM lists WHERE household_id = ?').all(oldHouseholdId) as { id: string }[]
    for (const list of lists) {
      const items = (
        db.prepare('SELECT COUNT(*) AS c FROM list_items WHERE list_id = ?').get(list.id) as { c: number }
      ).c
      if (items > 0) {
        db.prepare('UPDATE lists SET household_id = ? WHERE id = ?').run(targetHouseholdId, list.id)
      } else {
        db.prepare('DELETE FROM lists WHERE id = ?').run(list.id)
      }
    }

    db.prepare('DELETE FROM settings WHERE household_id = ?').run(oldHouseholdId)
    db.prepare('DELETE FROM invites WHERE household_id = ?').run(oldHouseholdId)
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(targetHouseholdId, userId)

    // Give the newcomer a distinct avatar color if theirs collides.
    const colors = db
      .prepare('SELECT id, color FROM users WHERE household_id = ?')
      .all(targetHouseholdId) as { id: string; color: string }[]
    const mine = colors.find((row) => row.id === userId)!
    if (colors.some((row) => row.id !== userId && row.color === mine.color)) {
      const used = colors.filter((row) => row.id !== userId).map((row) => row.color)
      const fresh = MEMBER_COLORS.find((color) => !used.includes(color)) ?? mine.color
      db.prepare('UPDATE users SET color = ? WHERE id = ?').run(fresh, userId)
    }

    db.prepare('DELETE FROM households WHERE id = ?').run(oldHouseholdId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/**
 * Redeem an invite. With a userId, the user's solo budget is merged into the
 * inviter's household and the code is consumed. With userId null (signup with
 * a code), the invite is only validated — the caller creates the user in the
 * returned household and marks the code used itself.
 */
export function redeemInviteCode(
  db: DatabaseSync,
  rawCode: string,
  userId: string | null,
): { householdId: string } {
  const invite = validateInvite(db, rawCode)
  if (userId) {
    const already = db
      .prepare('SELECT household_id FROM users WHERE id = ?')
      .get(userId) as { household_id: string }
    if (already.household_id === invite.household_id) badRequest('You’re already part of that household.')
    mergeHouseholds(db, userId, invite.household_id)
    db.prepare('UPDATE invites SET used_by_user_id = ?, used_at = ? WHERE code = ?').run(userId, now(), invite.code)
  }
  return { householdId: invite.household_id }
}
