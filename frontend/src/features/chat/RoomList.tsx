import type { Room } from './types'

export function RoomList({ rooms, activeId, onSelect }: { rooms: Room[]; activeId: string; onSelect: (id: string) => void }) {
  if (!rooms.length) return <p className="px-3 py-2 text-sm text-slate-500">No chats yet. Pick a user to start one.</p>
  return (
    <ul className="space-y-1" aria-label="Chats">
      {rooms.map((room) => (
        <li key={room.id}>
          <button
            type="button"
            className={`w-full rounded-lg px-3 py-2 text-left break-all ${room.id === activeId ? 'bg-slate-800 text-white' : 'hover:bg-slate-100'}`}
            aria-current={room.id === activeId ? 'true' : undefined}
            onClick={() => onSelect(room.id)}
          >
            {room.name}
            <span className="ml-2 text-xs opacity-70">{room.kind === 'group' ? 'group' : 'private'}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
