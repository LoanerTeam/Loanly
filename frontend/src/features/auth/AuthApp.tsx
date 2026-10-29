import { useEffect, useId, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { createAuthStore, type AuthState } from './store'
import type { AuthMode, Profile } from './api'
import { PasswordField } from './PasswordField'

export function AuthGuard({ state, children, retry, logout }: {
  state: AuthState; children: ReactNode; retry: () => void; logout: () => void
}) {
  if (state.status === 'checking') return <p role="status">Checking your account…</p>
  if (state.status === 'error') return <div>
    <p role="alert">{state.error}</p>
    <button className="mt-4 rounded-lg border px-4 py-2" onClick={retry}>Try again</button>
    <button className="ml-3 rounded-lg border px-4 py-2" onClick={logout}>Back to sign in</button>
  </div>
  return state.status === 'authenticated' ? children : null
}

export function AuthForm({ busy, error, onSubmit }: {
  busy: boolean; error: string
  onSubmit: (mode: AuthMode, username: string, password: string) => Promise<void>
}) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const passwordHelpId = useId()
  const confirmationErrorId = useId()
  const mismatch = submitted && mode === 'register' && password !== confirmPassword
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setSubmitted(true)
    if (mode === 'register' && password !== confirmPassword) return
    await onSubmit(mode, username, password)
    setPassword('')
    setConfirmPassword('')
    setShowPassword(false)
    setShowConfirmation(false)
  }
  return <form className="mt-6 space-y-4" onSubmit={submit}>
    <h2 className="text-xl font-semibold">{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
    <label className="block">Username
      <input className="mt-2 w-full rounded-lg border border-slate-300 p-2" value={username}
        onChange={(event) => setUsername(event.target.value)} pattern="[a-z0-9_]{3,20}"
        minLength={3} maxLength={20} required autoComplete="username" disabled={busy}
        aria-describedby="username-help" />
    </label>
    <p id="username-help" className="text-sm text-slate-500">3–20 lowercase letters, numbers or underscores.</p>
    <PasswordField label="Password" value={password} onChange={setPassword} visible={showPassword}
      onToggle={() => setShowPassword(!showPassword)} disabled={busy} describedBy={passwordHelpId}
      autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
    <p id={passwordHelpId} className="text-sm text-slate-500">At least 8 characters.</p>
    {mode === 'register' && <>
      <PasswordField label="Confirm password" value={confirmPassword} onChange={setConfirmPassword}
        visible={showConfirmation} onToggle={() => setShowConfirmation(!showConfirmation)}
        disabled={busy} autoComplete="new-password" invalid={mismatch}
        describedBy={mismatch ? confirmationErrorId : undefined} />
      {mismatch && <p id={confirmationErrorId} role="alert" className="text-sm text-red-600">Passwords do not match.</p>}
    </>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <button className="w-full rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
      type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Register'}</button>
    <button type="button" className="w-full text-sm underline" disabled={busy} onClick={() => {
      setMode(mode === 'login' ? 'register' : 'login'); setPassword(''); setConfirmPassword('')
      setShowPassword(false); setShowConfirmation(false); setSubmitted(false)
    }}>{mode === 'login' ? 'Create an account' : 'Already registered? Sign in'}</button>
    {submitted && !busy && error && <p className="text-sm text-slate-500">Check your details and try again.</p>}
  </form>
}

export function AuthApp({ renderChat }: {
  renderChat: (token: string, logout: () => void, profile: Profile) => ReactNode
}) {
  const [store] = useState(createAuthStore)
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => store.start(), [store])
  if (state.status === 'authenticated') {
    return <AuthGuard state={state} retry={() => void store.restore()} logout={() => store.logout()}>
      {state.user && renderChat(state.token, () => store.logout(), state.user)}
    </AuthGuard>
  }
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-800">
    <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8">
      <h1 className="text-3xl font-semibold">Loanly</h1>
      {state.status === 'anonymous'
        ? <AuthForm busy={state.busy} error={state.error} onSubmit={store.submit} />
        : <AuthGuard state={state} retry={() => void store.restore()} logout={() => store.logout()}>
            {null}
          </AuthGuard>}
    </div>
  </main>
}
