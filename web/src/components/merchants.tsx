import { useState } from 'react'
import type { DuplicatePair, Merchant } from '@fold/shared'
import { Store, Trash2 } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { fmtDate, fmtMoney } from '../format'
import { Avatar, Button, Chip, ErrorNote, Modal, TextInput, cls } from '../ui'

const TILE_COLORS = ['#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1']

function tileColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997
  return TILE_COLORS[hash % TILE_COLORS.length]
}

/**
 * A store's logo, fetched by website domain from Google's public favicon
 * service; falls back to a colored letter tile.
 */
export function MerchantLogo({
  name,
  domain,
  size = 30,
}: {
  name: string
  domain?: string | null
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  if (domain && !failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-slate-200"
        style={{ width: size, height: size }}
      >
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
          alt=""
          width={Math.round(size * 0.7)}
          height={Math.round(size * 0.7)}
          onError={() => setFailed(true)}
        />
      </span>
    )
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-on-accent"
      style={{ width: size, height: size, backgroundColor: tileColor(name), fontSize: size * 0.45 }}
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}

/** Manage stores: rename, set the website domain (that's where the logo comes from), delete. */
export function StoresModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { data, reload } = useApi<{ merchants: Merchant[] }>('/merchants')
  const [error, setError] = useState<string | null>(null)

  async function patch(merchant: Merchant, field: 'name' | 'domain', value: string): Promise<void> {
    const cleaned = value.trim()
    if (field === 'name' && (!cleaned || cleaned === merchant.name)) return
    if (field === 'domain' && cleaned === (merchant.domain ?? '')) return
    setError(null)
    try {
      await api.patch(`/merchants/${merchant.id}`, { [field]: field === 'domain' ? cleaned || null : cleaned })
      reload()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function remove(merchant: Merchant): Promise<void> {
    if (!confirm(`Remove "${merchant.name}"? Its transactions keep their text, just lose the store link.`)) return
    await api.delete(`/merchants/${merchant.id}`)
    reload()
    onChanged()
  }

  return (
    <Modal title="Stores" onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Add a store's website domain and its logo appears everywhere (loaded from Google's public favicon service).
          New stores are created right from the add-expense box.
        </p>
        <ErrorNote message={error} />
        {(data?.merchants ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No stores yet — type a name in the add-expense box and hit “add as store”.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(data?.merchants ?? []).map((merchant) => (
              <li key={merchant.id} className="flex items-center gap-3 py-2.5">
                <MerchantLogo name={merchant.name} domain={merchant.domain} size={34} />
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <TextInput
                    defaultValue={merchant.name}
                    onBlur={(e) => void patch(merchant, 'name', e.target.value)}
                    className="!py-1.5"
                  />
                  <TextInput
                    defaultValue={merchant.domain ?? ''}
                    placeholder="costco.com — for the logo"
                    onBlur={(e) => void patch(merchant, 'domain', e.target.value)}
                    className="!py-1.5"
                  />
                </div>
                <span className="w-14 shrink-0 text-right text-xs text-slate-400">
                  {merchant.uses} {merchant.uses === 1 ? 'use' : 'uses'}
                </span>
                <button
                  onClick={() => void remove(merchant)}
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

/** Review same-amount-same-week lookalikes: keep both, or delete one. */
export function DuplicatesModal({
  pairs,
  onClose,
  onChanged,
}: {
  pairs: DuplicatePair[]
  onClose: () => void
  onChanged: () => void
}) {
  const { me } = useMe()
  const [busy, setBusy] = useState(false)

  async function dismiss(pair: DuplicatePair): Promise<void> {
    setBusy(true)
    await api.post('/transactions/duplicates/dismiss', { a: pair.a.id, b: pair.b.id })
    onChanged()
    setBusy(false)
  }

  async function removeOne(txId: string): Promise<void> {
    if (!confirm('Delete this transaction? Its splits and category lines go with it.')) return
    setBusy(true)
    await api.delete(`/transactions/${txId}`)
    onChanged()
    setBusy(false)
  }

  function TxCard({ info }: { info: DuplicatePair['a'] }) {
    const payer = me.household.members.find((m) => m.id === info.payer_user_id)
    return (
      <div className="min-w-0 flex-1 rounded-xl border border-slate-200 p-3">
        <p className="truncate text-sm font-medium" title={info.description}>
          {info.description}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          {fmtDate(info.date)} · <span className="font-semibold tabular-nums">{fmtMoney(info.amount_cents)}</span>
          {payer && <Avatar name={payer.name} color={payer.color} size={16} />}
          <Chip className={cls('!px-1.5 !py-0 text-[10px]', info.imported ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-800')}>
            {info.imported ? 'imported' : 'manual'}
          </Chip>
        </p>
        <Button variant="danger" onClick={() => void removeOne(info.id)} disabled={busy} className="mt-2 !px-2.5 !py-1 text-xs">
          Delete this one
        </Button>
      </div>
    )
  }

  return (
    <Modal title="Possible duplicates" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Same amount within a few days of each other — usually a manual entry plus the imported statement row. Keep
          both if they're genuinely separate purchases.
        </p>
        {pairs.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">Nothing suspicious left.</p>
        ) : (
          pairs.map((pair) => (
            <div key={`${pair.a.id}:${pair.b.id}`} className="rounded-2xl border border-slate-200 p-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <TxCard info={pair.a} />
                <TxCard info={pair.b} />
              </div>
              <div className="mt-2 text-right">
                <Button variant="secondary" onClick={() => void dismiss(pair)} disabled={busy} className="!px-2.5 !py-1 text-xs">
                  Not duplicates — keep both
                </Button>
              </div>
            </div>
          ))
        )}
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs text-slate-400">
            <Store size={12} /> Imports also check for these automatically before they land.
          </span>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}
