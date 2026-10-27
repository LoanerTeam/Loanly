// One WebSocket per client. Features register `on(type, fn)` listeners and call `send(type, payload)`.
// F2 adds connect(token) with reconnect; frame shapes are in docs/CONTRACT.md.
type Listener = (frame: Record<string, unknown>) => void

const listeners = new Map<string, Set<Listener>>()
let socket: WebSocket | null = null

export function on(type: string, fn: Listener): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type)!.add(fn)
  return () => listeners.get(type)!.delete(fn)
}

export function dispatch(raw: string): void {
  const frame = JSON.parse(raw) as { type: string }
  listeners.get(frame.type)?.forEach((fn) => fn(frame))
}

export function send(type: string, payload: Record<string, unknown> = {}): void {
  socket?.send(JSON.stringify({ type, ...payload }))
}

export function connect(token: string): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  socket = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)
  socket.onmessage = (e) => dispatch(e.data)
}
