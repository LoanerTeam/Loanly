import { useEffect, useState, type FormEvent } from 'react'
import { connect, disconnect } from './ws/client'
import { resetPresence } from './features/presence/store'
import { usePresence } from './features/presence/usePresence'
import { UserList } from './features/presence/UserList'
import { ConnectionStatus } from './features/presence/ConnectionStatus'
import { readDevSession, saveDevSession, clearDevSession } from './features/presence/session'
import { deleteGroup, leaveGroup, resetGroups } from './features/groups/store'
import { useGroups } from './features/groups/useGroups'
import { GroupList } from './features/groups/GroupList'
import { CreateGroupForm } from './features/groups/CreateGroupForm'
import { openGroup, openPrivateChat, resetChat, selectRoom, sendMessage } from './features/chat/store'
import { useChat } from './features/chat/useChat'
import { ChatRoom } from './features/chat/ChatRoom'
import { RoomList } from './features/chat/RoomList'
import { AuthApp } from './features/auth/AuthApp'
import { RoomAiBar } from './ai/RoomAiBar'

// AuthApp supplies the verified JWT; chat features share this existing view.
export function PresenceApp({ token, onDisconnect }: { token: string; onDisconnect: () => void }) {
  const { me, users, status } = usePresence()
  const { groups, connected, acting, actionError } = useGroups()
  const chat = useChat()
  useEffect(() => {
    resetPresence()
    resetGroups()
    resetChat()
    connect(token)
    return () => { disconnect(); resetPresence(); resetGroups(); resetChat() }
  }, [token])
  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-800">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div><h1 className="text-3xl font-semibold">Loanly</h1><ConnectionStatus status={status} /></div>
          <button className="rounded-lg border border-slate-300 px-4 py-2" onClick={onDisconnect}>Log out</button>
        </header>
        <div className="grid gap-6 md:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 font-semibold">Users <span className="text-sm font-normal text-slate-500">{users.filter((u) => u.online).length} online</span></h2>
            <UserList users={users} me={me} onSelect={openPrivateChat} />
            {!users.length && <p className="px-3 py-2 text-sm text-slate-500">Waiting for user list…</p>}
            <div className="mt-6 border-t border-slate-200 pt-4">
              <h2 className="mb-3 font-semibold">Chats</h2>
              <RoomList rooms={chat.rooms} activeId={chat.activeId} unread={chat.unread} onSelect={selectRoom} />
            </div>
            <div className="mt-6 border-t border-slate-200 pt-4">
              <h2 className="mb-3 font-semibold">Groups</h2>
              <GroupList groups={groups} me={me} joining={chat.joining} acting={acting} connected={connected}
                error={actionError} onOpen={openGroup} onLeave={leaveGroup} onDelete={deleteGroup} />
              <CreateGroupForm />
            </div>
          </aside>
          {chat.active
            ? <ChatRoom room={chat.active} messages={chat.activeMessages} me={me} error={chat.error}
                toolbar={<RoomAiBar key={`${chat.active.id}:${chat.catchUp?.lastId ?? ''}`} room={chat.active}
                  messages={chat.activeMessages} me={me} catchUp={chat.catchUp} token={token} />}
                onSend={(text) => sendMessage(chat.active!.id, text)} />
            : <section className="rounded-2xl border border-slate-200 bg-white p-8">
                <h2 className="text-xl font-semibold">Welcome{me ? `, ${me}` : ''}</h2>
                <p className="mt-2 text-slate-500">Pick a user to start a private chat.</p>
                {chat.error && <p role="alert" className="mt-2 text-sm text-red-600">{chat.error}</p>}
              </section>}
        </div>
      </div>
    </main>
  )
}
function DevApp() {
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

export default function App() {
  if (import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH === '1') return <DevApp />
  return <AuthApp renderChat={(token, logout) => <PresenceApp token={token} onDisconnect={logout} />} />
}
