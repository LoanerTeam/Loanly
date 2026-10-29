import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const client = vi.hoisted(() => ({ status: 'connected', send: vi.fn() }))
vi.mock('../../ws/client', async (importOriginal) => ({ ...await importOriginal<typeof import('../../ws/client')>(), getConnectionStatus: () => client.status, send: client.send, on: vi.fn(), subscribeConnection: vi.fn() }))
import { renderToStaticMarkup } from 'react-dom/server'
import { RoomList } from './RoomList'
import { getChat, markActiveRead, receiveHistory, receiveInit, receiveMessage, resetChat, selectRoom } from './store'

const room = { id: 'r1', kind: 'private' as const, name: 'bob', members: ['alice', 'bob'], creator: null }
const other = { ...room, id: 'r2', name: 'carol', members: ['alice', 'carol'] }
const msg = (id: string, sender = 'bob', roomId = 'r1') => ({ id, roomId, sender, text: id, ts: '2026-01-01T00:00:00+00:00' })
const init = (unread: unknown = {}) => receiveInit({ type: 'init', me: 'alice', users: [], rooms: [room, other], unread })
const marks = () => client.send.mock.calls.filter(([type]) => type === 'read.mark')
beforeEach(() => { resetChat(); client.send.mockReset().mockReturnValue(true) })
afterEach(() => { vi.unstubAllGlobals() })

test('init seeds badges from the server and drops junk counts', () => {
  init({ r1: 3, r2: 0, r3: 'x', r4: -1 })
  expect(getChat().unread).toEqual({ r1: 3 })
})

test('messages from others in a background room raise the badge; your own never do', () => {
  init()
  receiveMessage({ type: 'message.new', message: msg('m1', 'carol', 'r2') })
  receiveMessage({ type: 'message.new', message: msg('m2', 'carol', 'r2') })
  receiveMessage({ type: 'message.new', message: msg('m3', 'alice', 'r2') })
  expect(getChat().unread).toEqual({ r2: 2 })
})

test('opening a room clears its badge and tells the server the latest message was read', () => {
  init({ r1: 2 })
  receiveMessage({ type: 'message.new', message: msg('m1') })
  receiveMessage({ type: 'message.new', message: msg('m2') })
  selectRoom('r1')
  expect(marks()).toHaveLength(0) // history not loaded yet, nothing to mark
  receiveHistory({ type: 'history', roomId: 'r1', messages: [msg('m1'), msg('m2')] })
  expect(getChat().unread.r1).toBe(0)
  expect(client.send).toHaveBeenCalledWith('read.mark', { roomId: 'r1', messageId: 'm2' })
})

test('messages arriving in the open, visible room are read at once and marked once each', () => {
  init()
  selectRoom('r1')
  receiveHistory({ type: 'history', roomId: 'r1', messages: [] })
  receiveMessage({ type: 'message.new', message: msg('m1') })
  markActiveRead() // nothing new, no duplicate mark
  expect(getChat().unread.r1 ?? 0).toBe(0)
  expect(marks()).toEqual([['read.mark', { roomId: 'r1', messageId: 'm1' }]])
})

test('a hidden tab keeps the badge until it becomes visible again', () => {
  init()
  selectRoom('r1')
  receiveHistory({ type: 'history', roomId: 'r1', messages: [] })
  const doc = { visibilityState: 'hidden' }
  vi.stubGlobal('document', doc)
  receiveMessage({ type: 'message.new', message: msg('m1') })
  expect(getChat().unread.r1).toBe(1)
  expect(marks()).toHaveLength(0)
  doc.visibilityState = 'visible'
  markActiveRead() // what the visibilitychange listener calls
  expect(getChat().unread.r1).toBe(0)
  expect(marks()).toHaveLength(1)
})

test('the room list shows a badge only for rooms with unread messages', () => {
  const html = renderToStaticMarkup(RoomList({ rooms: [room, other], activeId: '', unread: { r1: 3 }, onSelect: () => {} }))
  expect(html).toContain('aria-label="3 unread"')
  expect(html.match(/unread/g)).toHaveLength(1)
})
