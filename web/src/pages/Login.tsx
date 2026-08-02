import { useState } from 'react'
import { api } from '../api'
import { Button, ErrorNote, Field, TextInput, cls } from '../ui'

export default function Login({
  onDone,
  hasUsers,
  signupOpen,
}: {
  onDone: () => void
  hasUsers: boolean
  signupOpen: boolean
}) {
  const inviteFromUrl = new URLSearchParams(window.location.search).get('invite') ?? ''
  const [tab, setTab] = useState<'signin' | 'signup'>(inviteFromUrl || !hasUsers ? 'signup' : 'signin')
  const inviteRequired = hasUsers && !signupOpen
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState(inviteFromUrl)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (tab === 'signin') {
        await api.post('/auth/login', { email, password })
      } else {
        await api.post('/signup', {
          name,
          email,
          password,
          invite_code: inviteCode.trim() || undefined,
        })
      }
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-violet-50 via-slate-50 to-emerald-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="text-center">
          <span className="text-4xl">🪺</span>
          <h1 className="mt-2 text-xl font-bold">The Fold</h1>
          <p className="text-sm text-slate-500">Your home base, together.</p>
        </div>

        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-medium">
          {(
            [
              ['signin', 'Sign in'],
              ['signup', 'Create account'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value)
                setError(null)
              }}
              className={cls(
                'rounded-lg py-1.5 transition-colors',
                tab === value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'signup' && (
          <Field label="Your name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="Jake" />
          </Field>
        )}
        <Field label="Email">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={tab === 'signin'} required />
        </Field>
        <Field label="Password" hint={tab === 'signup' ? 'At least 6 characters.' : undefined}>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={tab === 'signup' ? 6 : undefined} required />
        </Field>
        {tab === 'signup' && !hasUsers && (
          <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">
            You're first — this account becomes the <strong>server admin</strong>. After this, new accounts need an
            invite code unless you open signup in Settings.
          </p>
        )}
        {tab === 'signup' && hasUsers && (
          <Field
            label={inviteRequired ? 'Invite code' : 'Invite code (optional)'}
            hint={
              inviteRequired
                ? 'This server is invite-only — ask your partner (or the admin) for a code.'
                : 'Got a code from your partner? Your accounts link into one household — otherwise you start your own budget and can link later.'
            }
          >
            <TextInput
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="XXXX-XXXX"
              required={inviteRequired}
              className="uppercase tracking-widest"
            />
          </Field>
        )}

        <ErrorNote message={error} />
        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? 'One sec…' : tab === 'signin' ? 'Sign in' : inviteCode.trim() ? 'Create & link accounts' : 'Create my account'}
        </Button>
      </form>
    </div>
  )
}
