import { Inbox, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { fmtMoney, parseMoney } from './format'

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  className?: string
}) {
  const styles = {
    primary:
      'bg-violet-600 bg-gradient-to-b from-violet-500 to-violet-600 text-on-accent hover:from-violet-600 hover:to-violet-700 shadow-sm',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cls(
        'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        styles[variant],
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cls('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm', className)}>{children}</div>
  )
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{children}</h2>
      {action}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[8vh]" onClick={onClose}>
      <div
        className={cls('w-full rounded-2xl bg-white p-6 shadow-xl', wide ? 'max-w-2xl' : 'max-w-md')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink shadow-sm placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cls(inputCls, props.className)} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cls(inputCls, 'bg-white', props.className)} />
}

/**
 * Numeric field that buffers text while focused. Plain type=number inputs keep
 * stray leading zeros ("010") because React leaves the DOM alone when the
 * values compare loosely equal — this owns the text instead, clears a lone 0
 * on focus, and reports a clean number on every keystroke.
 */
export function NumberInput({
  value,
  onValue,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number
  onValue: (v: number) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? (Number.isFinite(value) ? String(value) : '0')
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={shown}
      onFocus={(e) => {
        setText(value === 0 ? '' : String(value))
        e.target.select()
        rest.onFocus?.(e)
      }}
      onChange={(e) => {
        let raw = e.target.value.replace(/[^0-9.]/g, '')
        const dot = raw.indexOf('.')
        if (dot !== -1) raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, '')
        raw = raw.replace(/^0+(?=\d)/, '')
        setText(raw)
        const parsed = raw === '' || raw === '.' ? 0 : parseFloat(raw)
        onValue(Number.isFinite(parsed) ? parsed : 0)
      }}
      onBlur={(e) => {
        setText(null)
        rest.onBlur?.(e)
      }}
      className={cls(className)}
    />
  )
}

/** Dollar input that reports integer cents (null while invalid/empty). */
export function MoneyInput({
  cents,
  onCents,
  placeholder = '0.00',
  autoFocus,
  className,
}: {
  cents: number | null
  onCents: (cents: number | null) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}) {
  const [text, setText] = useState(cents != null ? (cents / 100).toFixed(2) : '')
  useEffect(() => {
    const parsed = parseMoney(text)
    if ((cents ?? null) !== (parsed ?? null)) {
      setText(cents != null ? (cents / 100).toFixed(2) : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents])
  return (
    <div className={cls('relative', className)}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">$</span>
      <input
        value={text}
        autoFocus={autoFocus}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          onCents(parseMoney(e.target.value))
        }}
        className={cls(inputCls, 'pl-7')}
      />
    </div>
  )
}

export function ProgressBar({
  value,
  max,
  color = 'var(--color-accent)',
  className,
}: {
  value: number
  max: number
  color?: string
  className?: string
}) {
  const over = max > 0 && value > max
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : value > 0 ? 100 : 0
  const fill = over ? '#ef4444' : color
  return (
    <div className={cls('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${fill} 78%, white), ${fill})` }}
      />
    </div>
  )
}

export function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-on-accent"
      style={{
        width: size,
        height: size,
        backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${color} 82%, white), ${color} 55%, color-mix(in srgb, ${color} 82%, #0f172a))`,
        fontSize: size * 0.4,
      }}
    >
      {initials}
    </span>
  )
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cls(
        'inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {icon ?? <Inbox size={18} />}
      </span>
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="text-sm text-slate-500">{children}</div>}
    </div>
  )
}

/** The app mark: a folded sheet on the accent tile. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="shrink-0">
      <rect width="512" height="512" rx="112" fill="var(--color-accent)" />
      <path d="M156 118h140l80 80v176a20 20 0 0 1-20 20H156a20 20 0 0 1-20-20V138a20 20 0 0 1 20-20z" fill="#fff" />
      <path d="M296 118l80 80h-80z" fill="rgba(255,255,255,0.55)" />
    </svg>
  )
}

export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={cls('tabular-nums', className)}>{fmtMoney(cents)}</span>
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>
}
