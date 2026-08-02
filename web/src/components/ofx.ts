/**
 * Minimal OFX/QFX reader. Banks export SGML-ish or XML flavors; both mark
 * transactions with <STMTTRN> blocks and (usually) unclosed value tags.
 */

export interface OfxRow {
  date: string
  description: string
  /** The Fold's sign convention: positive = spending, negative = credit/refund. */
  amount_cents: number
  external_id: string | null
}

export interface OfxStatement {
  rows: OfxRow[]
  balance: { amount_cents: number; date: string } | null
}

export function looksLikeOfx(text: string): boolean {
  const head = text.slice(0, 600).toUpperCase()
  return head.includes('OFXHEADER') || head.includes('<OFX')
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block)
  return match ? match[1].trim() : null
}

function ofxDate(value: string | null): string | null {
  const digits = value?.match(/^(\d{4})(\d{2})(\d{2})/)
  return digits ? `${digits[1]}-${digits[2]}-${digits[3]}` : null
}

export function parseOfx(text: string): OfxStatement {
  const rows: OfxRow[] = []
  for (const match of text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)) {
    const block = match[1]
    const date = ofxDate(tag(block, 'DTPOSTED'))
    const amountRaw = tag(block, 'TRNAMT')
    const amount = amountRaw != null ? Number.parseFloat(amountRaw.replace(',', '.')) : NaN
    const name = tag(block, 'NAME')
    const memo = tag(block, 'MEMO')
    const description = name || memo
    if (!date || !Number.isFinite(amount) || amount === 0 || !description) continue
    rows.push({
      date,
      // OFX: negative = money out. The Fold: positive = spending.
      amount_cents: -Math.round(amount * 100),
      description: name && memo && memo !== name ? `${name} — ${memo}` : description,
      external_id: tag(block, 'FITID'),
    })
  }

  let balance: OfxStatement['balance'] = null
  const ledger = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|$)/i.exec(text)
  if (ledger) {
    const amountRaw = tag(ledger[1], 'BALAMT')
    const amount = amountRaw != null ? Number.parseFloat(amountRaw.replace(',', '.')) : NaN
    const date = ofxDate(tag(ledger[1], 'DTASOF'))
    if (Number.isFinite(amount) && date) {
      balance = { amount_cents: Math.round(amount * 100), date }
    }
  }
  return { rows, balance }
}
