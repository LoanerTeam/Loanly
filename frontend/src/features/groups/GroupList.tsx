import { type Group } from './types'

export function GroupList({ groups, me, joining = '', acting = '', connected = true, error = '', onOpen, onLeave, onDelete }: {
  groups: Group[]
  me: string
  joining?: string
  acting?: string
  connected?: boolean
  error?: string
  onOpen: (id: string) => void
  onLeave: (id: string) => void
  onDelete: (id: string) => void
}) {
  if (!groups.length) return <p className="text-sm text-slate-500">No Groups yet.</p>
  const busy = !connected || !!acting
  return <>{error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
  <ul className="space-y-3">{groups.map((group) => <li key={group.id} className="rounded-lg bg-slate-50 p-3">
    <h3 className="font-medium break-words">{group.name}</h3>
    <p className="text-sm text-slate-600">Creator: {group.creator}{group.creator === me ? ' (you)' : ''}</p>
    <p className="text-sm text-slate-600 break-words">Members: {group.members.join(', ')}</p>
    {group.members.includes(me)
      ? <button type="button" className="mt-2 rounded-lg border border-slate-300 px-3 py-1 text-sm"
          onClick={() => onOpen(group.id)}>Open</button>
      : <button type="button" className="mt-2 rounded-lg bg-slate-800 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={!connected || !!joining} onClick={() => onOpen(group.id)}>
          {joining === group.id ? 'Joining…' : 'Join'}
        </button>}
    {/* Only the Creator can delete; the Creator cannot leave. Non-Members see neither. */}
    {group.creator === me
      ? <button type="button" className="mt-2 ml-2 rounded-lg border border-red-300 px-3 py-1 text-sm text-red-700 disabled:opacity-50"
          disabled={busy} onClick={() => window.confirm(`Delete ${group.name} and all its messages for everyone?`) && onDelete(group.id)}>
          {acting === group.id ? 'Deleting…' : 'Delete'}
        </button>
      : group.members.includes(me) && <button type="button" className="mt-2 ml-2 rounded-lg border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
          disabled={busy} onClick={() => onLeave(group.id)}>
          {acting === group.id ? 'Leaving…' : 'Leave'}
        </button>}
  </li>)}</ul></>
}
