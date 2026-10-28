import { isInitFrame, on, type Frame } from '../../ws/client'

export type User = { username: string; online: boolean }
export type PresenceState = { me: string; users: User[] }
const empty: PresenceState = { me: '', users: [] }
let state = empty
const listeners = new Set<() => void>()

export function getPresence(): PresenceState { return state }
export function subscribePresence(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function publish(next: PresenceState): void {
  state = next
  listeners.forEach((fn) => fn())
}
export function resetPresence(): void { publish(empty) }
function isUser(value: unknown): value is User {
  return !!value && typeof value === 'object' && 'username' in value &&
    typeof value.username === 'string' && 'online' in value && typeof value.online === 'boolean'
}
function sortUsers(users: User[]): User[] {
  return users.sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username))
}
export function receiveInit(frame: Frame): void {
  if (!isInitFrame(frame)) return
  publish({ me: frame.me, users: sortUsers([...new Map(frame.users.map((u) => [u.username, u])).values()]) })
}
export function receivePresence(frame: Frame): void {
  if (!isUser(frame)) return
  const users = new Map(state.users.map((u) => [u.username, u]))
  users.set(frame.username, { username: frame.username, online: frame.online })
  publish({ ...state, users: sortUsers([...users.values()]) })
}
// One subscription per module, independent of component mounting and React StrictMode.
on('init', receiveInit)
on('presence', receivePresence)
