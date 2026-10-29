export type Room = {
  id: string
  kind: 'private' | 'group'
  name: string
  members: string[]
  creator: string | null
}
export type Message = { id: string; roomId: string; sender: string; text: string; ts: string }

export const MAX_TEXT = 2000

export function isRoom(value: unknown): value is Room {
  if (!value || typeof value !== 'object') return false
  const room = value as Record<string, unknown>
  return typeof room.id === 'string' && (room.kind === 'private' || room.kind === 'group') &&
    typeof room.name === 'string' && (room.creator === null || typeof room.creator === 'string') &&
    Array.isArray(room.members) && room.members.every((m) => typeof m === 'string')
}

export function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return typeof m.id === 'string' && typeof m.roomId === 'string' && typeof m.sender === 'string' &&
    typeof m.text === 'string' && typeof m.ts === 'string'
}
