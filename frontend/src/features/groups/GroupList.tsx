import { type Group } from './types'

export function GroupList({ groups, me }: { groups: Group[]; me: string }) {
  if (!groups.length) return <p className="text-sm text-slate-500">No Groups yet.</p>
  return <ul className="space-y-3">{groups.map((group) => <li key={group.id} className="rounded-lg bg-slate-50 p-3">
    <h3 className="font-medium break-words">{group.name}</h3>
    <p className="text-sm text-slate-600">Creator: {group.creator}{group.creator === me ? ' (you)' : ''}</p>
    <p className="text-sm text-slate-600 break-words">Members: {group.members.join(', ')}</p>
  </li>)}</ul>
}
