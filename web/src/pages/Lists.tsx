import { useEffect, useState } from 'react'
import type { ListItemRow, ListRow, ListType } from '@fold/shared'
import { Brush, CalendarDays, Link2, List as ListIcon, Plus, ShoppingCart, SquareCheck, Star, Trash2, UserRound } from 'lucide-react'
import { api, useApi } from '../api'
import { useMe } from '../App'
import { fmtDate, fmtMoney } from '../format'
import { Avatar, Button, Card, ErrorNote, Field, Modal, MoneyInput, Select, TextInput, cls } from '../ui'

function TypeIcon({ type, size = 15 }: { type: ListType; size?: number }) {
  const Icon =
    type === 'todo' ? SquareCheck : type === 'chores' ? Brush : type === 'grocery' ? ShoppingCart : type === 'wishlist' ? Star : ListIcon
  return <Icon size={size} className="shrink-0 text-slate-400" />
}

function NewListModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ListType>('todo')
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    try {
      await api.post('/lists', { name: name.trim(), type, emoji: null })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title="New list" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Weekend projects" />
        </Field>
        <Field label="Kind" hint="Wishlist items get a price field so you can dream responsibly.">
          <Select value={type} onChange={(e) => setType(e.target.value as ListType)}>
            <option value="todo">To-dos</option>
            <option value="chores">Chores</option>
            <option value="grocery">Groceries</option>
            <option value="wishlist">Wishlist</option>
            <option value="custom">Something else</option>
          </Select>
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!name.trim()}>Create list</Button>
        </div>
      </div>
    </Modal>
  )
}

function ItemEditor({
  item,
  isWishlist,
  onClose,
  onSaved,
}: {
  item: ListItemRow
  isWishlist: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { me } = useMe()
  const [text, setText] = useState(item.text)
  const [assignee, setAssignee] = useState(item.assignee_user_id ?? '')
  const [due, setDue] = useState(item.due_date ?? '')
  const [amount, setAmount] = useState<number | null>(item.amount_cents)
  const [url, setUrl] = useState(item.url ?? '')
  const [notes, setNotes] = useState(item.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    try {
      await api.patch(`/list-items/${item.id}`, {
        text: text.trim(),
        assignee_user_id: assignee || null,
        due_date: due || null,
        amount_cents: amount,
        url: url || null,
        notes: notes || null,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function remove(): Promise<void> {
    await api.delete(`/list-items/${item.id}`)
    onSaved()
  }

  return (
    <Modal title="Edit item" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Item">
          <TextInput value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Assigned to">
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Nobody</option>
              {me.household.members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Due date">
            <TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        {isWishlist && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price">
              <MoneyInput cents={amount} onCents={setAmount} />
            </Field>
            <Field label="Link">
              <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </Field>
          </div>
        )}
        <Field label="Notes">
          <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Wait for a sale…" />
        </Field>
        <ErrorNote message={error} />
        <div className="flex items-center justify-between">
          <Button variant="danger" onClick={() => void remove()}>
            <Trash2 size={14} /> Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save()} disabled={!text.trim()}>Save</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default function Lists() {
  const { me } = useMe()
  const { data, reload } = useApi<{ lists: ListRow[] }>('/lists')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newItem, setNewItem] = useState('')
  const [editing, setEditing] = useState<ListItemRow | null>(null)

  const lists = data?.lists ?? []
  const selected = lists.find((l) => l.id === selectedId) ?? lists[0] ?? null

  useEffect(() => {
    if (!selectedId && lists.length > 0) setSelectedId(lists[0].id)
  }, [lists, selectedId])

  async function addItem(): Promise<void> {
    if (!selected || !newItem.trim()) return
    await api.post(`/lists/${selected.id}/items`, { text: newItem.trim() })
    setNewItem('')
    reload()
  }

  async function toggle(item: ListItemRow): Promise<void> {
    await api.patch(`/list-items/${item.id}`, { done: item.done === 1 ? 0 : 1 })
    reload()
  }

  async function clearDone(): Promise<void> {
    if (!selected) return
    await api.post(`/lists/${selected.id}/clear-done`)
    reload()
  }

  async function removeList(): Promise<void> {
    if (!selected) return
    if (!confirm(`Delete the "${selected.name}" list and everything on it?`)) return
    await api.delete(`/lists/${selected.id}`)
    setSelectedId(null)
    reload()
  }

  const doneCount = selected?.items.filter((i) => i.done === 1).length ?? 0
  const isWishlist = selected?.type === 'wishlist'
  const wishlistTotal = isWishlist
    ? selected!.items.filter((i) => i.done === 0).reduce((sum, i) => sum + (i.amount_cents ?? 0), 0)
    : 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Lists</h1>
          <p className="text-sm text-slate-500">Groceries, chores, someday-dreams — all in one place, both of you.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={15} /> New list
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
          {lists.map((list) => {
            const open = list.items.filter((i) => i.done === 0).length
            return (
              <button
                key={list.id}
                onClick={() => setSelectedId(list.id)}
                className={cls(
                  'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors md:w-full',
                  selected?.id === list.id
                    ? 'border-violet-300 bg-violet-50 text-violet-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                )}
              >
                <TypeIcon type={list.type} />
                <span className="flex-1 truncate">{list.name}</span>
                <span className={cls('rounded-full px-1.5 text-xs', selected?.id === list.id ? 'bg-violet-200/70' : 'bg-slate-100')}>
                  {open}
                </span>
              </button>
            )
          })}
        </div>

        {selected ? (
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold">
                {selected.name}
                {isWishlist && wishlistTotal > 0 && (
                  <span className="ml-2 text-sm font-normal text-slate-500">{fmtMoney(wishlistTotal)} to dream about</span>
                )}
              </h2>
              <div className="flex gap-1.5">
                {doneCount > 0 && (
                  <Button variant="ghost" onClick={() => void clearDone()} className="text-xs">
                    Clear {doneCount} done
                  </Button>
                )}
                <Button variant="ghost" onClick={() => void removeList()} className="text-xs text-red-500">
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>

            <div className="mb-3 flex gap-2">
              <TextInput
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addItem()}
                placeholder={isWishlist ? 'Add a wish…' : 'Add an item…'}
                className="flex-1"
              />
              <Button onClick={() => void addItem()} disabled={!newItem.trim()}>
                Add
              </Button>
            </div>

            {selected.items.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">Nothing here yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {selected.items.map((item) => {
                  const assignee = me.household.members.find((m) => m.id === item.assignee_user_id)
                  return (
                    <li key={item.id} className="flex items-center gap-3 py-2">
                      <input
                        type="checkbox"
                        checked={item.done === 1}
                        onChange={() => void toggle(item)}
                        className="h-4 w-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                      />
                      <button onClick={() => setEditing(item)} className="min-w-0 flex-1 text-left">
                        <span className={cls('text-sm', item.done === 1 && 'text-slate-400 line-through')}>{item.text}</span>
                        {item.notes && <span className="block truncate text-xs text-slate-400">{item.notes}</span>}
                      </button>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-violet-600">
                          <Link2 size={14} />
                        </a>
                      )}
                      {item.amount_cents != null && (
                        <span className="text-xs font-medium tabular-nums text-slate-500">{fmtMoney(item.amount_cents)}</span>
                      )}
                      {item.due_date && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          <CalendarDays size={12} /> {fmtDate(item.due_date)}
                        </span>
                      )}
                      {assignee ? (
                        <Avatar name={assignee.name} color={assignee.color} size={22} />
                      ) : (
                        <button onClick={() => setEditing(item)} title="Assign" className="text-slate-300 hover:text-slate-500">
                          <UserRound size={16} />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-slate-500">Create a list to get going.</p>
          </Card>
        )}
      </div>

      {creating && (
        <NewListModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            reload()
          }}
        />
      )}
      {editing && selected && (
        <ItemEditor
          item={editing}
          isWishlist={isWishlist}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
