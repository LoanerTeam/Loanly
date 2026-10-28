import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { connect, disconnect, dispatch, getConnectionStatus, on, send, subscribeConnection } from './client'

class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()
  constructor(public url: string) { FakeSocket.instances.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  receive(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }) }
  end(code = 1006) { this.readyState = 3; this.onclose?.({ code }) }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('location', { protocol: 'https:', host: 'loanly.test' })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  FakeSocket.instances = []
})
afterEach(() => { disconnect(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
function latest() { return FakeSocket.instances.at(-1)! }

test('dispatch filters frame types, ignores malformed frames and unsubscribes', () => {
  const a = vi.fn(), b = vi.fn()
  const offA = on('message.new', a), offB = on('presence', b)
  dispatch(JSON.stringify({ type: 'message.new', message: { id: '1' } }))
  expect(a).toHaveBeenCalledOnce()
  expect(b).not.toHaveBeenCalled()
  for (const raw of ['invalid', 'null', '[]', '{"type":3}']) dispatch(raw)
  offA(); offB()
  dispatch('{"type":"message.new"}')
  expect(a).toHaveBeenCalledOnce()
})
test('waits for init, sends only on open socket and exposes status subscription', () => {
  const listener = vi.fn(), off = subscribeConnection(listener)
  expect(send('message.send')).toBe(false)
  connect('alice token')
  expect(latest().url).toBe('wss://loanly.test/ws?token=alice%20token')
  expect(getConnectionStatus()).toBe('connecting')
  latest().open()
  expect(getConnectionStatus()).toBe('connecting')
  latest().receive({ type: 'init' })
  expect(getConnectionStatus()).toBe('connecting')
  latest().receive({ type: 'init', me: 'alice', users: [] })
  expect(getConnectionStatus()).toBe('connected')
  expect(send('message.send', { text: 'hello', type: 'wrong' })).toBe(true)
  expect(latest().send).toHaveBeenCalledWith('{"text":"hello","type":"message.send"}')
  expect(listener).toHaveBeenCalled()
  off()
})
test('reconnect backs off, replaces init snapshot, and resets after a successful init', () => {
  const receive = vi.fn(), off = on('init', receive)
  connect('alice')
  latest().end()
  expect(getConnectionStatus()).toBe('reconnecting')
  vi.advanceTimersByTime(799)
  expect(FakeSocket.instances).toHaveLength(1)
  vi.advanceTimersByTime(1)
  expect(FakeSocket.instances).toHaveLength(2)
  latest().end()
  vi.advanceTimersByTime(1599)
  expect(FakeSocket.instances).toHaveLength(2)
  vi.advanceTimersByTime(1)
  expect(FakeSocket.instances).toHaveLength(3)
  latest().receive({ type: 'init', me: 'alice', users: [] })
  expect(receive).toHaveBeenCalledOnce()
  latest().end()
  vi.advanceTimersByTime(800)
  expect(FakeSocket.instances).toHaveLength(4)
  off()
})
test('auth rejection and explicit disconnect cancel reconnect', () => {
  connect('bad')
  latest().end(4401)
  expect(getConnectionStatus()).toBe('unauthorized')
  vi.runAllTimers()
  expect(FakeSocket.instances).toHaveLength(1)
  connect('alice')
  latest().end()
  disconnect()
  vi.runAllTimers()
  expect(FakeSocket.instances).toHaveLength(2)
  expect(getConnectionStatus()).toBe('disconnected')
})
test('ignores stale frames and close events after replacing a connection', () => {
  connect('alice')
  const old = latest()
  connect('bob')
  old.receive({ type: 'init' })
  old.end(4401)
  expect(old.close).toHaveBeenCalledOnce()
  expect(getConnectionStatus()).toBe('connecting')
  vi.runAllTimers()
  expect(FakeSocket.instances).toHaveLength(2)
})
