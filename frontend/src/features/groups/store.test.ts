import { beforeEach, expect, test, vi } from 'vitest'
const client = vi.hoisted(() => ({ status: 'connected', send: vi.fn() }))
vi.mock('../../ws/client', async (importOriginal) => ({ ...await importOriginal<typeof import('../../ws/client')>(), getConnectionStatus: () => client.status, send: client.send, on: vi.fn(), subscribeConnection: vi.fn() }))
import {
  connectionChanged, createGroup, deleteGroup, getGroups, leaveGroup, receiveError, receiveGroup, receiveGroupRemoved,
  receiveInit, resetGroups, setGroupDraft,
} from './store'
import { on } from '../../ws/client'
const group = { id: 'one', kind: 'group', name: 'team', creator: 'alice', members: ['alice'] }
beforeEach(() => { resetGroups(); client.status = 'connected'; client.send.mockReset().mockReturnValue(true) })
function ready() { receiveInit({ type: 'init', me: 'alice', users: [], groups: [] }) }

test('retains same-name Groups from different Creators in snapshots and updates', () => {
  const other = { ...group, id: 'two', creator: 'bob', members: ['bob'] }
  receiveInit({ type: 'init', me: 'alice', users: [], groups: [group, other] })
  expect(getGroups().groups).toHaveLength(2)
  receiveGroup({ type: 'group.upsert', group: { ...other, members: ['bob', 'carol'] } })
  expect(getGroups().groups).toHaveLength(2)
  expect(getGroups().groups.find((item) => item.id === 'one')?.members).toEqual(['alice'])
  expect(getGroups().groups.find((item) => item.id === 'two')?.members).toEqual(['bob', 'carol'])
})

test('replaces snapshots and upserts by id without duplicate groups', () => {
  receiveInit({ type: 'init', me: 'alice', users: [], groups: [group] })
  receiveGroup({ type: 'group.upsert', group: { ...group, members: ['alice', 'bob'] } })
  expect(getGroups().groups).toHaveLength(1)
  expect(getGroups().groups[0].members).toEqual(['alice', 'bob'])
  receiveInit({ type: 'init', me: 'alice', users: [], groups: [] })
  receiveGroup({ type: 'group.upsert', group: { ...group, members: [3] } })
  receiveInit({ type: 'init', me: 'alice', users: [], groups: null })
  expect(getGroups().groups).toEqual([])
})
test('validates input and blocks disconnected, duplicate and failed sends', () => {
  ready(); setGroupDraft('   ')
  expect(createGroup()).toBe(false)
  expect(client.send).not.toHaveBeenCalled()
  setGroupDraft('team'); client.status = 'reconnecting'
  expect(createGroup()).toBe(false)
  client.status = 'connected'; client.send.mockReturnValue(false)
  expect(createGroup()).toBe(false)
  expect(getGroups().pending).toBeNull()
  expect(getGroups().draft).toBe('team')
  client.send.mockReturnValue(true)
  expect(createGroup()).toBe(true)
  expect(createGroup()).toBe(false)
})
test('correlates only matching success and errors; errors preserve the draft', () => {
  ready(); setGroupDraft(' team '); createGroup()
  const reqId = getGroups().pending
  expect(client.send).toHaveBeenCalledWith('group.create', { name: 'team', reqId })
  receiveGroup({ type: 'group.upsert', group, reqId: 'other' })
  receiveError({ type: 'error', reqId: 'other', detail: 'irrelevant' })
  expect(getGroups().pending).toBe(reqId)
  expect(getGroups().draft).toBe(' team ')
  receiveError({ type: 'error', reqId, code: 'name_taken', detail: 'Name taken' })
  expect(getGroups().error).toBe('Name taken')
  expect(getGroups().draft).toBe(' team ')
  createGroup()
  receiveGroup({ type: 'group.upsert', group, reqId: getGroups().pending })
  expect(getGroups().pending).toBeNull()
  expect(getGroups().draft).toBe('')
  expect(getGroups().notice).toBe('Group created.')
})
test('disconnect reports uncertain creation without resending; stale success cannot clear new request', () => {
  ready(); setGroupDraft('team'); createGroup()
  const oldId = getGroups().pending
  client.status = 'reconnecting'; connectionChanged()
  expect(getGroups().pending).toBeNull()
  expect(getGroups().ready).toBe(false)
  expect(getGroups().notice).toContain('unconfirmed')
  client.status = 'connected'; connectionChanged()
  expect(getGroups().ready).toBe(false)
  receiveInit({ type: 'init', me: 'alice', users: [], groups: [group] })
  expect(client.send).toHaveBeenCalledTimes(1)
  setGroupDraft('other'); createGroup()
  receiveGroup({ type: 'group.upsert', group, reqId: oldId })
  expect(getGroups().draft).toBe('other')
  expect(getGroups().pending).not.toBeNull()
  resetGroups()
  expect(getGroups()).toMatchObject({ groups: [], draft: '', pending: null, ready: false, error: '', notice: '' })
})

test('malformed init cannot mark Group state ready', () => {
  receiveInit({ type: 'init', groups: [group] })
  expect(getGroups().ready).toBe(false)
  expect(getGroups().groups).toEqual([])
})

test('leave and delete send one request each and clear when confirmed', () => {
  receiveInit({ type: 'init', me: 'alice', users: [], groups: [group] })
  expect(leaveGroup('one')).toBe(true)
  const leaveReq = getGroups().actionReq
  expect(client.send).toHaveBeenCalledWith('group.leave', { groupId: 'one', reqId: leaveReq })
  expect(getGroups().acting).toBe('one')
  expect(deleteGroup('one')).toBe(false) // one action at a time
  receiveGroupRemoved({ type: 'group.removed', groupId: 'one', reqId: 'other' })
  expect(getGroups().groups).toEqual([])
  expect(getGroups().actionReq).toBe(leaveReq)
  receiveError({ type: 'error', reqId: leaveReq, code: 'creator_cannot_leave', detail: 'The Creator cannot leave' })
  expect(getGroups()).toMatchObject({ acting: '', actionReq: null, actionError: 'The Creator cannot leave' })
  expect(getGroups().error).toBe('')
  expect(deleteGroup('one')).toBe(true)
  const deleteReq = getGroups().actionReq
  expect(client.send).toHaveBeenLastCalledWith('group.delete', { groupId: 'one', reqId: deleteReq })
  receiveGroupRemoved({ type: 'group.removed', groupId: 'one', reqId: deleteReq })
  expect(getGroups()).toMatchObject({ acting: '', actionReq: null, actionError: '' })
})

test('leave and delete are blocked while disconnected and cleared on connection loss', () => {
  expect(leaveGroup('one')).toBe(false)
  expect(getGroups().actionError).toContain('Connect')
  ready(); client.send.mockReturnValue(false)
  expect(deleteGroup('one')).toBe(false)
  expect(getGroups().acting).toBe('')
  client.send.mockReturnValue(true); leaveGroup('one')
  client.status = 'reconnecting'; connectionChanged()
  expect(getGroups()).toMatchObject({ acting: '', actionReq: null })
})

test('room.removed with the leave reqId confirms the leave', () => {
  // The store registers its listeners through the mocked `on` when it is imported.
  const removed = vi.mocked(on).mock.calls.find(([type]) => type === 'room.removed')![1]
  ready(); leaveGroup('one')
  removed({ type: 'room.removed', roomId: 'one', reqId: 'other' })
  expect(getGroups().acting).toBe('one')
  removed({ type: 'room.removed', roomId: 'one', reqId: getGroups().actionReq })
  expect(getGroups()).toMatchObject({ acting: '', actionReq: null })
})
