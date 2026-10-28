import { useEffect, useState, type FormEvent } from 'react'
import { connect, disconnect } from './ws/client'
import { resetPresence } from './features/presence/store'
import { usePresence } from './features/presence/usePresence'
import { UserList } from './features/presence/UserList'
import { ConnectionStatus } from './features/presence/ConnectionStatus'
import { readDevSession, saveDevSession, clearDevSession } from './features/presence/session'

// F1 can render this with its JWT; the username form is development-only.
export function PresenceApp({ token, onDisconnect }: { token: string; onDisconnect: () => void }) {
  const { me, users, status } = usePresence()
  useEffect(() => {
    resetPresence()
    connect(token)
    return () => { disconnect(); resetPresence() }
  }, [token])
  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-800">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div><h1 className="text-3xl font-semibold">Loanly</h1><ConnectionStatus status={status} /></div>
          <button className="rounded-lg border border-slate-300 px-4 py-2" onClick={onDisconnect}>Disconnect</button>
        </header>
        <div className="grid gap-6 md:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 font-semibold">Users <span className="text-sm font-normal text-slate-500">{users.filter((u) => u.online).length} online</span></h2>
            <UserList users={users} me={me} />
            {!users.length && <p className="px-3 py-2 text-sm text-slate-500">Waiting for user list…</p>}
          </aside>
          <section className="rounded-2xl border border-slate-200 bg-white p-8">
            <h2 className="text-xl font-semibold">Welcome{me ? `, ${me}` : ''}</h2>
            <p className="mt-2 text-slate-500">See who is online in the user list.</p>
          </section>
        </div>
      </div>
    </main>
  )
}
export default function App() {
  const [token, setToken] = useState(() => import.meta.env.DEV ? readDevSession() : '')
  const [username, setUsername] = useState('')
  if (token) return <PresenceApp token={token} onDisconnect={() => {
    clearDevSession()
    setToken('')
  }} />
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = username.trim()
    saveDevSession(next)
    setToken(next)
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-800">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-3xl font-semibold">Loanly</h1>
        {import.meta.env.DEV ? <form className="mt-6 space-y-4" onSubmit={submit}>
          <p className="text-sm text-slate-500">Development connection · backend requires DEV_AUTH=1</p>
          <label className="block">Username<input className="mt-2 w-full rounded-lg border border-slate-300 p-2" value={username} onChange={(e) => setUsername(e.target.value)} pattern="[a-z0-9_]{3,20}" minLength={3} maxLength={20} required autoComplete="username" /></label>
          <button className="w-full rounded-lg bg-slate-800 px-4 py-2 text-white" type="submit">Connect</button>
        </form> : <p className="mt-4 text-slate-500">Sign-in will be available with the account feature.</p>}
      </div>
    </main>
  )
}
