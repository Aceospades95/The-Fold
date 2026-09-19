import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cls } from './ui'

export type ToastTone = 'info' | 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
  /** Optional one-shot action ("Undo", "Open"). */
  action?: { label: string; onClick: () => void }
}

type Listener = (items: ToastItem[]) => void

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<Listener>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function publish(): void {
  for (const listener of listeners) listener(items)
}

export function dismissToast(id: number): void {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  items = items.filter((item) => item.id !== id)
  publish()
}

/**
 * Fire-and-forget notice in the corner. Errors linger a little longer; an
 * identical message already on screen is not stacked twice.
 */
export function toast(message: string, tone: ToastTone = 'info', action?: ToastItem['action']): void {
  if (items.some((item) => item.message === message && item.tone === tone)) return
  const id = nextId++
  items = [...items.slice(-3), { id, message, tone, action }]
  publish()
  timers.set(
    id,
    setTimeout(() => dismissToast(id), tone === 'error' ? 7000 : 4500),
  )
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items)
  useEffect(() => {
    listeners.add(setList)
    return () => {
      listeners.delete(setList)
    }
  }, [])
  if (list.length === 0) return null
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
    >
      {list.map((item) => {
        const Icon = item.tone === 'error' ? AlertCircle : item.tone === 'success' ? CheckCircle2 : Info
        return (
          <div
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
            className={cls(
              'pointer-events-auto flex w-full max-w-md items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm shadow-lg',
              'bg-ink text-paper',
            )}
          >
            <Icon
              size={16}
              className={cls(
                'shrink-0',
                item.tone === 'error' ? 'text-red-400' : item.tone === 'success' ? 'text-emerald-500' : 'text-slate-300',
              )}
            />
            <span className="min-w-0 flex-1">{item.message}</span>
            {item.action && (
              <button
                onClick={() => {
                  item.action?.onClick()
                  dismissToast(item.id)
                }}
                className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold underline-offset-2 hover:underline"
              >
                {item.action.label}
              </button>
            )}
            <button onClick={() => dismissToast(item.id)} aria-label="Dismiss" className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
