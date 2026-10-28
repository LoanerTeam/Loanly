import { getConnectionStatus, isInitFrame, on, send, subscribeConnection, type Frame } from '../../ws/client'
import { isGroup, type Group } from './types'

export type GroupsState = {
  groups: Group[]
  draft: string
  pending: string | null
  ready: boolean
  error: string
  notice: string
}
const initial = (): GroupsState => ({ groups: [], draft: '', pending: null, ready: false, error: '', notice: '' })
let state = initial()
let sequence = 0
const listeners = new Set<() => void>()
export function getGroups(): GroupsState { return state }
export function subscribeGroups(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function update(changes: Partial<GroupsState>): void {
  state = { ...state, ...changes }
  listeners.forEach((fn) => fn())
}
export function resetGroups(): void { update(initial()) }
export function setGroupDraft(draft: string): void { update({ draft, error: '', notice: '' }) }
function sorted(groups: Group[]): Group[] {
  return [...new Map(groups.map((group) => [group.id, group])).values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
export function receiveInit(frame: Frame): void {
  if (!isInitFrame(frame) || !Array.isArray(frame.groups) || !frame.groups.every(isGroup)) return
  update({ groups: sorted(frame.groups), ready: true })
}
export function receiveGroup(frame: Frame): void {
  if (!isGroup(frame.group)) return
  const matching = !!state.pending && frame.reqId === state.pending
  update({ groups: sorted([...state.groups, frame.group]),
    ...(matching ? { pending: null, draft: '', error: '', notice: 'Group created.' } : {}) })
}
export function receiveError(frame: Frame): void {
  if (!state.pending || frame.reqId !== state.pending) return
  update({ pending: null, error: typeof frame.detail === 'string' ? frame.detail : 'Could not create Group.' })
}
export function connectionChanged(): void {
  if (getConnectionStatus() === 'connected') return
  update({ ready: false, ...(state.pending ? {
    pending: null, notice: 'Connection lost. Creation is unconfirmed; check the Group list after reconnecting before retrying.',
  } : {}) })
}
export function createGroup(): boolean {
  const name = state.draft.trim()
  if (!name) { update({ error: 'Enter a Group name.' }); return false }
  if (state.pending) return false
  if (!state.ready || getConnectionStatus() !== 'connected') {
    update({ error: 'Connect before creating a Group.' }); return false
  }
  // Works on LAN HTTP, where crypto.randomUUID may be unavailable.
  const reqId = `group-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`
  update({ pending: reqId, error: '', notice: '' })
  if (!send('group.create', { name, reqId })) {
    update({ pending: null, error: 'Could not send. Check your connection and try again.' })
    return false
  }
  return true
}
on('init', receiveInit)
on('group.upsert', receiveGroup)
on('error', receiveError)
subscribeConnection(connectionChanged)
