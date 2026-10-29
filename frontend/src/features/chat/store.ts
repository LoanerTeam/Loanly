import { getConnectionStatus, isInitFrame, on, send, subscribeConnection, type Frame } from '../../ws/client'
import { isMessage, isRoom, MAX_TEXT, type Message, type Room } from './types'

export type ChatState = {
  rooms: Room[]
  messages: Record<string, Message[]>
  loaded: string[] // rooms whose full history arrived on this connection
  activeId: string
  pendingOpen: string | null // reqId of a dm.open we should select when it comes back
  error: string
}
const initial = (): ChatState => ({ rooms: [], messages: {}, loaded: [], activeId: '', pendingOpen: null, error: '' })
let state = initial()
let sequence = 0
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
export function resetChat(): void { update(initial()) }

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
  update({ rooms, loaded: [], activeId, pendingOpen: null })
  if (activeId) fetchHistory(activeId)
}
export function receiveRoom(frame: Frame): void {
  if (!isRoom(frame.room)) return
  const mine = !!state.pendingOpen && frame.reqId === state.pendingOpen
  update({ rooms: sortedRooms([...state.rooms, frame.room]), ...(mine ? { pendingOpen: null } : {}) })
  if (mine) selectRoom(frame.room.id)
}
export function receiveRoomRemoved(frame: Frame): void {
  if (typeof frame.roomId !== 'string') return
  const messages = Object.fromEntries(Object.entries(state.messages).filter(([id]) => id !== frame.roomId))
  update({
    rooms: state.rooms.filter((r) => r.id !== frame.roomId), messages,
    loaded: state.loaded.filter((id) => id !== frame.roomId),
    activeId: state.activeId === frame.roomId ? '' : state.activeId,
  })
}
export function receiveMessage(frame: Frame): void {
  const message = frame.message
  if (!isMessage(message)) return
  const list = state.messages[message.roomId] ?? []
  if (list.some((m) => m.id === message.id)) return
  update({ messages: { ...state.messages, [message.roomId]: [...list, message] } })
}
export function receiveHistory(frame: Frame): void {
  if (typeof frame.roomId !== 'string' || !Array.isArray(frame.messages)) return
  update({
    messages: { ...state.messages, [frame.roomId]: frame.messages.filter(isMessage) },
    loaded: [...new Set([...state.loaded, frame.roomId])],
  })
}
export function receiveError(frame: Frame): void {
  if (!state.pendingOpen || frame.reqId !== state.pendingOpen) return
  update({ pendingOpen: null, error: typeof frame.detail === 'string' && frame.detail ? frame.detail : 'Could not open chat.' })
}
export function connectionChanged(): void {
  if (getConnectionStatus() !== 'connected') update({ loaded: [], pendingOpen: null })
}

export function selectRoom(roomId: string): void {
  update({ activeId: roomId, error: '' })
  fetchHistory(roomId)
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
on('message.new', receiveMessage)
on('history', receiveHistory)
on('error', receiveError)
subscribeConnection(connectionChanged)
