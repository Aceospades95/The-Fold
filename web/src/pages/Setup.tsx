import { useState } from 'react'
import { api } from '../api'
import { Button, ErrorNote, Field, TextInput } from '../ui'

export default function Setup({ onDone }: { onDone: () => void }) {
  const [householdName, setHouseholdName] = useState('')
  const [you, setYou] = useState({ name: '', email: '', password: '' })
  const [addPartner, setAddPartner] = useState(true)
  const [partner, setPartner] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/setup', {
        household_name: householdName,
        you,
        partner: addPartner ? partner : undefined,
      })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-violet-50 via-slate-50 to-emerald-50 p-4">
      <form onSubmit={submit} className="w-full max-w-lg space-y-5 rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="text-center">
          <span className="text-4xl">🪺</span>
          <h1 className="mt-2 text-xl font-bold">Welcome to The Fold</h1>
          <p className="text-sm text-slate-500">One-time setup for your household.</p>
        </div>

        <Field label="Household name" hint='Something like "Jake & Sam" — it shows up around the app.'>
          <TextInput value={householdName} onChange={(e) => setHouseholdName(e.target.value)} autoFocus required />
        </Field>

        <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-600">You</legend>
          <Field label="Name">
            <TextInput value={you.name} onChange={(e) => setYou({ ...you, name: e.target.value })} required />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={you.email} onChange={(e) => setYou({ ...you, email: e.target.value })} required />
          </Field>
          <Field label="Password">
            <TextInput
              type="password"
              value={you.password}
              onChange={(e) => setYou({ ...you, password: e.target.value })}
              minLength={6}
              required
            />
          </Field>
        </fieldset>

        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={addPartner}
            onChange={(e) => setAddPartner(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
          />
          Add my partner now (you can also do this later in Settings)
        </label>

        {addPartner && (
          <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-600">Your partner</legend>
            <Field label="Name">
              <TextInput value={partner.name} onChange={(e) => setPartner({ ...partner, name: e.target.value })} required />
            </Field>
            <Field label="Email">
              <TextInput
                type="email"
                value={partner.email}
                onChange={(e) => setPartner({ ...partner, email: e.target.value })}
                required
              />
            </Field>
            <Field label="Temporary password" hint="They can use this to sign in — share it with them.">
              <TextInput
                type="password"
                value={partner.password}
                onChange={(e) => setPartner({ ...partner, password: e.target.value })}
                minLength={6}
                required
              />
            </Field>
          </fieldset>
        )}

        <ErrorNote message={error} />
        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? 'Creating…' : 'Create our home base'}
        </Button>
      </form>
    </div>
  )
}
