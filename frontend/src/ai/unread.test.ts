import { expect, test } from 'vitest'
import { unreadForSummary } from './unread'

const msg = (id: string, sender: string, text = id) => ({ id, roomId: 'g1', sender, text, ts: '2026-01-01T00:00:00Z' })
const history = [msg('m1', 'bob'), msg('m2', 'alice'), msg('m3', 'bob'), msg('m4', 'carol'), msg('m5', 'bob')]

test('picks the last count messages from others up to the newest seen on opening', () => {
  const lines = unreadForSummary(history, 'alice', { roomId: 'g1', count: 2, lastId: 'm4' }, 'g1')
  expect(lines).toEqual([{ sender: 'bob', text: 'm3' }, { sender: 'carol', text: 'm4' }])
})

test('never includes my own messages or messages that arrived after opening', () => {
  const lines = unreadForSummary(history, 'alice', { roomId: 'g1', count: 10, lastId: 'm4' }, 'g1')
  expect(lines.map((l) => l.text)).toEqual(['m1', 'm3', 'm4'])
})

test('sends only the latest 200 Unread Messages', () => {
  const many = Array.from({ length: 250 }, (_, i) => msg(`m${i}`, 'bob'))
  const lines = unreadForSummary(many, 'alice', { roomId: 'g1', count: 250, lastId: 'm249' }, 'g1')
  expect(lines).toHaveLength(200)
  expect(lines[0].text).toBe('m50')
  expect(lines[199].text).toBe('m249')
})

test('returns nothing for another room, zero unread, no catch-up or history not loaded yet', () => {
  expect(unreadForSummary(history, 'alice', { roomId: 'g2', count: 2, lastId: 'm4' }, 'g1')).toEqual([])
  expect(unreadForSummary(history, 'alice', { roomId: 'g1', count: 0, lastId: 'm4' }, 'g1')).toEqual([])
  expect(unreadForSummary(history, 'alice', null, 'g1')).toEqual([])
  expect(unreadForSummary([], 'alice', { roomId: 'g1', count: 2, lastId: 'm4' }, 'g1')).toEqual([])
})
