import { beforeEach, expect, test, vi } from 'vitest'
const client = vi.hoisted(() => ({ status: 'connected', send: vi.fn() }))
vi.mock('../../ws/client', async (importOriginal) => ({ ...await importOriginal<typeof import('../../ws/client')>(), getConnectionStatus: () => client.status, send: client.send, on: vi.fn(), subscribeConnection: vi.fn() }))
import { connectionChanged, createGroup, getGroups, receiveError, receiveGroup, receiveInit, resetGroups, setGroupDraft } from './store'
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
