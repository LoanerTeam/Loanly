import type { User } from './store'

export function UserList({ users, me }: { users: User[]; me: string }) {
  return (
    <ul className="space-y-1" aria-label="Users">
      {users.map((user) => (
        <li key={user.username} className="flex items-center gap-3 rounded-lg px-3 py-2">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${user.online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          <span className="min-w-0 flex-1 break-all">{user.username}{user.username === me && <span className="text-slate-500"> (you)</span>}</span>
          <span className="text-xs text-slate-500">{user.online ? 'Online' : 'Offline'}</span>
        </li>
      ))}
    </ul>
  )
}
