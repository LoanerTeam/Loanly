import { getConnectionStatus, isInitFrame, on, send, subscribeConnection, type Frame } from '../../ws/client'
import { isGroup } from '../groups/types'
import { isMessage, isRoom, MAX_TEXT, type Message, type Room } from './types'

// Unread count of a room when it was last marked read, kept so it can still be summarized.
export type CatchUp = { roomId: string; count: number; lastId: string }
export type ChatState = {
  rooms: Room[]
  messages: Record<string, Message[]>
  loaded: string[] // rooms whose full history arrived on this connection
  activeId: string
  pendingOpen: string | null // reqId of a dm.open or group.join we should select when it comes back
  joining: string // id of the Group a pending group.join is for
  me: string
  unread: Record<string, number>
  catchUp: CatchUp | null
  error: string
}
const initial = (): ChatState => ({ rooms: [], messages: {}, loaded: [], activeId: '', pendingOpen: null, joining: '', me: '', unread: {}, catchUp: null, error: '' })
let state = initial()
let sequence = 0
let lastMarked: Record<string, string> = {} // roomId -> last message id we told the server about
const listeners = new Set<() => void>()

export function getChat(): ChatState { return state }
export function subscribeChat(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function update(changes: Partial<ChatState>): void {
  state = { ...state, ...changes }
  listeners.forEach((fn) => fn())
}
export function resetChat(): void { lastMarked = {}; update(initial()) }

const viewing = () => typeof document === 'undefined' || document.visibilityState === 'visible'
// Mark the open room read, but only while the tab is visible, so background tabs keep their badge.
export function markActiveRead(): void {
  const roomId = state.activeId
  if (!roomId || !viewing()) return
  const list = state.messages[roomId] ?? []
  const last = list[list.length - 1]
  if (!last || !state.loaded.includes(roomId)) return
  if (state.unread[roomId]) {
    update({ unread: { ...state.unread, [roomId]: 0 }, catchUp: { roomId, count: state.unread[roomId], lastId: last.id } })
  }
  if (lastMarked[roomId] === last.id) return
  if (send('read.mark', { roomId, messageId: last.id })) lastMarked[roomId] = last.id
}
function unreadFrom(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).filter(([, n]) => Number.isInteger(n) && (n as number) > 0)) as Record<string, number>
}

function sortedRooms(rooms: Room[]): Room[] {
  return [...new Map(rooms.map((room) => [room.id, room])).values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
function fetchHistory(roomId: string): void {
  if (!state.loaded.includes(roomId)) send('history.get', { roomId })
}

export function receiveInit(frame: Frame): void {
  if (!isInitFrame(frame) || !Array.isArray(frame.rooms)) return
  const rooms = sortedRooms(frame.rooms.filter(isRoom))
  const activeId = rooms.some((r) => r.id === state.activeId) ? state.activeId : ''
  // A new connection may have missed messages, so history is fetched again.
  lastMarked = {}
  update({ rooms, loaded: [], activeId, pendingOpen: null, joining: '', me: frame.me, unread: unreadFrom(frame.unread) })
  if (activeId) fetchHistory(activeId)
}
export function receiveRoom(frame: Frame): void {
  if (!isRoom(frame.room)) return
  const mine = !!state.pendingOpen && frame.reqId === state.pendingOpen
  update({ rooms: sortedRooms([...state.rooms, frame.room]), ...(mine ? { pendingOpen: null, joining: '' } : {}) })
  if (mine) selectRoom(frame.room.id)
}
// Keeps a joined Group's member list current; Groups I am not in are not rooms.
export function receiveGroup(frame: Frame): void {
  const group = frame.group
  if (!isGroup(group) || !state.rooms.some((r) => r.id === group.id)) return
  update({ rooms: sortedRooms(state.rooms.map((r) => (r.id === group.id ? group : r))) })
}
export function receiveRoomRemoved(frame: Frame): void {
  if (typeof frame.roomId !== 'string') return
  dropRoom(frame.roomId)
}
// A deleted Group disappears for its Members the same way as a room they left.
export function receiveGroupRemoved(frame: Frame): void {
  if (typeof frame.groupId === 'string') dropRoom(frame.groupId)
}
function dropRoom(roomId: string): void {
  const messages = Object.fromEntries(Object.entries(state.messages).filter(([id]) => id !== roomId))
  update({
    rooms: state.rooms.filter((r) => r.id !== roomId), messages,
    loaded: state.loaded.filter((id) => id !== roomId),
    unread: Object.fromEntries(Object.entries(state.unread).filter(([id]) => id !== roomId)),
    activeId: state.activeId === roomId ? '' : state.activeId,
    catchUp: state.catchUp?.roomId === roomId ? null : state.catchUp,
  })
}
export function receiveMessage(frame: Frame): void {
  const message = frame.message
  if (!isMessage(message)) return
  const list = state.messages[message.roomId] ?? []
  if (list.some((m) => m.id === message.id)) return
  const unseen = message.sender !== state.me && !(message.roomId === state.activeId && viewing())
  update({
    messages: { ...state.messages, [message.roomId]: [...list, message] },
    ...(unseen ? { unread: { ...state.unread, [message.roomId]: (state.unread[message.roomId] ?? 0) + 1 } } : {}),
  })
  if (message.roomId === state.activeId) markActiveRead()
}
export function receiveHistory(frame: Frame): void {
  if (typeof frame.roomId !== 'string' || !Array.isArray(frame.messages)) return
  update({
    messages: { ...state.messages, [frame.roomId]: frame.messages.filter(isMessage) },
    loaded: [...new Set([...state.loaded, frame.roomId])],
  })
  if (frame.roomId === state.activeId) markActiveRead()
}
export function receiveError(frame: Frame): void {
  if (!state.pendingOpen || frame.reqId !== state.pendingOpen) return
  update({ pendingOpen: null, joining: '', error: typeof frame.detail === 'string' && frame.detail ? frame.detail : 'Could not open chat.' })
}
export function connectionChanged(): void {
  if (getConnectionStatus() !== 'connected') update({ loaded: [], pendingOpen: null, joining: '' })
}

export function selectRoom(roomId: string): void {
  update({ activeId: roomId, error: '', ...(state.catchUp?.roomId === roomId ? {} : { catchUp: null }) })
  fetchHistory(roomId)
  markActiveRead()
}
export function openPrivateChat(username: string): boolean {
  const existing = state.rooms.find((r) => r.kind === 'private' && r.name === username)
  if (existing) { selectRoom(existing.id); return true }
  const reqId = `dm-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`
  update({ pendingOpen: reqId, error: '' })
  if (!send('dm.open', { username, reqId })) {
    update({ pendingOpen: null, error: 'Could not send. Check your connection and try again.' })
    return false
  }
  return true
}
// A Member opens the Group's room; anyone else joins it first (self only, never added by others).
export function openGroup(groupId: string): boolean {
  if (state.rooms.some((r) => r.id === groupId)) { selectRoom(groupId); return true }
  if (state.pendingOpen) return false
  const reqId = `join-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`
  update({ pendingOpen: reqId, joining: groupId, error: '' })
  if (!send('group.join', { groupId, reqId })) {
    update({ pendingOpen: null, joining: '', error: 'Could not send. Check your connection and try again.' })
    return false
  }
  return true
}
export function sendMessage(roomId: string, text: string): boolean {
  if (!text.trim()) return false
  if (text.length > MAX_TEXT) { update({ error: `Messages are limited to ${MAX_TEXT} characters.` }); return false }
  if (!send('message.send', { roomId, text })) {
    update({ error: 'Could not send. Check your connection and try again.' })
    return false
  }
  update({ error: '' })
  return true
}

on('init', receiveInit)
on('room.upsert', receiveRoom)
on('room.removed', receiveRoomRemoved)
on('group.upsert', receiveGroup)
on('group.removed', receiveGroupRemoved)
on('message.new', receiveMessage)
on('history', receiveHistory)
on('error', receiveError)
subscribeConnection(connectionChanged)
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', markActiveRead)
