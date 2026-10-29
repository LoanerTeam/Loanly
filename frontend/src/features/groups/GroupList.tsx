import { type Group } from './types'

export function GroupList({ groups, me, joining = '', connected = true, onOpen }: {
  groups: Group[]
  me: string
  joining?: string
  connected?: boolean
  onOpen: (id: string) => void
}) {
  if (!groups.length) return <p className="text-sm text-slate-500">No Groups yet.</p>
  return <ul className="space-y-3">{groups.map((group) => <li key={group.id} className="rounded-lg bg-slate-50 p-3">
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
  </li>)}</ul>
}
