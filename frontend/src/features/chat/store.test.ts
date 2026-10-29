import { beforeEach, expect, test, vi } from 'vitest'
const client = vi.hoisted(() => ({ status: 'connected', send: vi.fn() }))
vi.mock('../../ws/client', async (importOriginal) => ({ ...await importOriginal<typeof import('../../ws/client')>(), getConnectionStatus: () => client.status, send: client.send, on: vi.fn(), subscribeConnection: vi.fn() }))
import {
  connectionChanged, getChat, openPrivateChat, receiveError, receiveHistory, receiveInit, receiveMessage,
  receiveRoom, receiveRoomRemoved, resetChat, selectRoom, sendMessage,
} from './store'

const room = { id: 'r1', kind: 'private', name: 'bob', members: ['alice', 'bob'], creator: null }
const msg = (id: string, text = 'hi', roomId = 'r1') => ({ id, roomId, sender: 'bob', text, ts: '2026-01-01T00:00:00+00:00' })
const init = (rooms: unknown[]) => receiveInit({ type: 'init', me: 'alice', users: [], rooms })
beforeEach(() => { resetChat(); client.status = 'connected'; client.send.mockReset().mockReturnValue(true) })

test('init replaces rooms, ignores invalid rooms and re-fetches history of the open room', () => {
  init([room, { id: 5 }])
  expect(getChat().rooms).toEqual([room])
  selectRoom('r1')
  receiveHistory({ type: 'history', roomId: 'r1', messages: [msg('m1')] })
  client.send.mockClear()
  init([room]) // reconnect: messages may have been missed
  expect(client.send).toHaveBeenCalledWith('history.get', { roomId: 'r1' })
  expect(getChat().activeId).toBe('r1')
})

test('selecting a room fetches history once and keeps no duplicate fetch while loaded', () => {
  init([room])
  selectRoom('r1')
  expect(client.send).toHaveBeenCalledWith('history.get', { roomId: 'r1' })
  receiveHistory({ type: 'history', roomId: 'r1', messages: [msg('m1')] })
  client.send.mockClear()
  selectRoom('r1')
  expect(client.send).not.toHaveBeenCalled()
})

test('messages append in order, are de-duplicated by id and bad frames are ignored', () => {
  init([room])
  receiveMessage({ type: 'message.new', message: msg('m1', 'one') })
  receiveMessage({ type: 'message.new', message: msg('m2', 'two') })
  receiveMessage({ type: 'message.new', message: msg('m2', 'two') })
  receiveMessage({ type: 'message.new', message: { id: 'x' } })
  expect(getChat().messages.r1.map((m) => m.text)).toEqual(['one', 'two'])
  receiveHistory({ type: 'history', roomId: 'r1', messages: [msg('m1', 'one'), msg('m2', 'two'), msg('m3', 'three')] })
  expect(getChat().messages.r1).toHaveLength(3)
})

test('opening a chat sends dm.open and selects the room that answers our request', () => {
  init([])
  expect(openPrivateChat('bob')).toBe(true)
  const [, { reqId }] = client.send.mock.calls[0]
  receiveRoom({ type: 'room.upsert', room, reqId: 'someone-else' })
  expect(getChat().activeId).toBe('') // a room pushed to us does not steal focus
  receiveRoom({ type: 'room.upsert', room, reqId })
  expect(getChat().activeId).toBe('r1')
  expect(getChat().pendingOpen).toBeNull()
})

test('opening an existing chat selects it without a dm.open', () => {
  init([room])
  openPrivateChat('bob')
  expect(client.send).not.toHaveBeenCalledWith('dm.open', expect.anything())
  expect(getChat().activeId).toBe('r1')
})

test('dm.open failure shows the server detail', () => {
  init([])
  openPrivateChat('ghost')
  const [, { reqId }] = client.send.mock.calls[0]
  receiveError({ type: 'error', code: 'unknown_user', detail: 'No such user', reqId })
  expect(getChat().error).toBe('No such user')
  expect(getChat().pendingOpen).toBeNull()
})

test('sendMessage rejects blank and over-long text and reports a failed send', () => {
  init([room])
  expect(sendMessage('r1', '   ')).toBe(false)
  expect(sendMessage('r1', 'x'.repeat(2001))).toBe(false)
  expect(client.send).not.toHaveBeenCalled()
  client.send.mockReturnValue(false)
  expect(sendMessage('r1', 'hi')).toBe(false)
  expect(getChat().error).toMatch(/Could not send/)
  client.send.mockReturnValue(true)
  expect(sendMessage('r1', 'hi')).toBe(true)
  expect(client.send).toHaveBeenLastCalledWith('message.send', { roomId: 'r1', text: 'hi' })
  expect(getChat().error).toBe('')
})

test('removing a room clears it, its messages and the selection; disconnect forces a re-fetch', () => {
  init([room])
  selectRoom('r1')
  receiveHistory({ type: 'history', roomId: 'r1', messages: [msg('m1')] })
  client.status = 'reconnecting'
  connectionChanged()
  expect(getChat().loaded).toEqual([])
  receiveRoomRemoved({ type: 'room.removed', roomId: 'r1' })
  expect(getChat().rooms).toEqual([])
  expect(getChat().messages.r1).toBeUndefined()
  expect(getChat().activeId).toBe('')
})
