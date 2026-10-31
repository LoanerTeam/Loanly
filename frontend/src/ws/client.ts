export type Frame = Record<string, unknown> & { type: string }
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'unauthorized'
type Listener = (frame: Frame) => void

const listeners = new Map<string, Set<Listener>>()
const statusListeners = new Set<() => void>()
let socket: WebSocket | null = null
let status: ConnectionStatus = 'disconnected'
let retry: ReturnType<typeof setTimeout> | undefined
let generation = 0

export function on(type: string, fn: Listener): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type)!.add(fn)
  return () => { listeners.get(type)?.delete(fn) }
}

export function dispatch(raw: string): void {
  let frame: unknown
  try { frame = JSON.parse(raw) } catch { return }
  dispatchFrame(frame)
}

function dispatchFrame(frame: unknown): void {
  if (!frame || typeof frame !== 'object' || !('type' in frame) || typeof frame.type !== 'string') return
  listeners.get(frame.type)?.forEach((fn) => fn(frame as Frame))
}

export function isInitFrame(value: unknown): value is Frame & { me: string; users: { username: string; online: boolean }[] } {
  if (!value || typeof value !== 'object') return false
  const frame = value as Record<string, unknown>
  return frame.type === 'init' && typeof frame.me === 'string' && Array.isArray(frame.users) &&
    frame.users.every((user: unknown) => !!user && typeof user === 'object' &&
      'username' in user && typeof user.username === 'string' &&
      'online' in user && typeof user.online === 'boolean')
}

export function getConnectionStatus(): ConnectionStatus { return status }
export function subscribeConnection(fn: () => void): () => void {
  statusListeners.add(fn)
  return () => { statusListeners.delete(fn) }
}
function setStatus(next: ConnectionStatus): void {
  status = next
  statusListeners.forEach((fn) => fn())
}

export function send(type: string, payload: Record<string, unknown> = {}): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false
  try { socket.send(JSON.stringify({ ...payload, type })); return true } catch { return false }
}

export function disconnect(): void {
  generation += 1
  clearTimeout(retry)
  retry = undefined
  const previous = socket
  socket = null
  previous?.close()
  setStatus('disconnected')
}

export function connect(token: string): void {
  disconnect()
  if (!token) { setStatus('unauthorized'); return }
  const current = generation
  let attempts = 0
  function open(): void {
    if (current !== generation) return
    setStatus(attempts ? 'reconnecting' : 'connecting')
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const active = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)
    socket = active
    const isCurrent = () => current === generation && socket === active
    active.onopen = () => { if (isCurrent()) setStatus(attempts ? 'reconnecting' : 'connecting') }
    active.onmessage = (event) => {
      if (!isCurrent() || typeof event.data !== 'string') return
      // Ready means the server has supplied a fresh snapshot, not just a transport.
      let frame: unknown
      try { frame = JSON.parse(event.data) } catch { return }
      if (isInitFrame(frame)) {
        attempts = 0
        setStatus('connected')
      }
      dispatchFrame(frame)
    }
    active.onclose = (event) => {
      if (!isCurrent()) return
      socket = null
      if (event.code === 4401) { setStatus('unauthorized'); return }
      setStatus('reconnecting')
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5))
      retry = setTimeout(open, delay * (0.8 + Math.random() * 0.2))
    }
    // Browsers follow error with close; scheduling only in close avoids duplicate retries.
    active.onerror = () => {}
  }
  open()
}
