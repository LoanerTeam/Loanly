// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'
import { readToken, saveToken } from './features/auth/session'
import { saveDevSession } from './features/presence/session'

class Socket {
  static instances: Socket[] = []
  static OPEN = 1
  readyState = 0
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  close = vi.fn()
  constructor(public url: string) { Socket.instances.push(this) }
}

beforeEach(() => {
  sessionStorage.clear()
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
  vi.stubEnv('VITE_DEV_AUTH', '0')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

test('application defaults to real Login/Register and ignores the old development session', () => {
  saveDevSession('alice')
  render(<App />)
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Create an account' })).toBeTruthy()
  expect(Socket.instances).toHaveLength(0)
})

test('verified JWT connects existing chat; logout closes WS, clears token and removes the user list', async () => {
  saveToken('signed-jwt')
  let resolve!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done })))
  render(<StrictMode><App /></StrictMode>)
  expect(Socket.instances).toHaveLength(0)
  await act(async () => resolve(new Response(JSON.stringify({ username: 'alice', targetLang: 'en' }))))
  await waitFor(() => expect(Socket.instances.length).toBeGreaterThan(0))
  const ws = Socket.instances.at(-1)!
  expect(ws.url).toContain('/ws?token=signed-jwt')
  await act(async () => ws.onmessage?.({ data: JSON.stringify({
    type: 'init', me: 'alice', users: [{ username: 'alice', online: true }, { username: 'bob', online: false }],
    rooms: [], groups: [], unread: {},
  }) }))
  expect(screen.getByRole('button', { name: /bob/ })).toBeTruthy()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Log out' }))
  expect(ws.close).toHaveBeenCalled()
  expect(readToken()).toBe('')
  expect(screen.queryByRole('button', { name: /bob/ })).toBeNull()
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
})

test('development Username form requires explicit opt-in and is excluded from production mode', () => {
  vi.stubEnv('DEV', true)
  vi.stubEnv('VITE_DEV_AUTH', '1')
  const mounted = render(<App />)
  expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy()
  mounted.unmount()
  vi.stubEnv('DEV', false)
  render(<App />)
  expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
})

test('restores translation preference on reload and wires message translation through REST', async () => {
  saveToken('signed-jwt')
  let language = 'th'
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/ai/translate') return new Response(JSON.stringify({ translation: 'สวัสดี' }))
    if (options?.method === 'PUT') language = JSON.parse(options.body as string).targetLang
    return new Response(JSON.stringify({ username: 'alice', targetLang: language }))
  })
  vi.stubGlobal('fetch', fetch)
  const first = render(<App />)
  expect(await screen.findByRole('combobox')).toHaveProperty('value', 'th')
  await userEvent.selectOptions(screen.getByRole('combobox'), 'ja')
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveProperty('value', 'ja'))
  first.unmount()
  render(<App />)
  expect(await screen.findByRole('combobox')).toHaveProperty('value', 'ja')
  const ws = Socket.instances.at(-1)!
  const room = { id: 'r1', kind: 'private', name: 'bob', members: ['alice', 'bob'], creator: null }
  await act(async () => ws.onmessage?.({ data: JSON.stringify({
    type: 'init', me: 'alice', users: [], rooms: [room], groups: [], unread: {},
  }) }))
  await userEvent.click(screen.getByRole('button', { name: /bob/ }))
  await act(async () => ws.onmessage?.({ data: JSON.stringify({
    type: 'history', roomId: 'r1', messages: [
      { id: 'm1', roomId: 'r1', sender: 'bob', text: 'Hello', ts: '2026-01-01T10:00:00Z' },
    ],
  }) }))
  await userEvent.click(await screen.findByRole('button', { name: 'Translate' }))
  expect(await screen.findByText('สวัสดี')).toBeTruthy()
  expect(fetch).toHaveBeenCalledWith('/api/ai/translate', expect.objectContaining({
    body: JSON.stringify({ text: 'Hello', targetLang: 'ja' }),
  }))
})

test('wires Speak beside Translate and stops audio when the room changes', async () => {
  saveToken('signed-jwt')
  const pause = vi.fn()
  const revoke = vi.fn()
  vi.stubGlobal('Audio', class {
    pause = pause
    play = vi.fn().mockResolvedValue(undefined)
    removeAttribute = vi.fn()
    load = vi.fn()
  })
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:speech', revokeObjectURL: revoke })
  const fetch = vi.fn(async (url: string) => url === '/api/ai/tts'
    ? new Response('wav', { headers: { 'Content-Type': 'audio/wav' } })
    : new Response(JSON.stringify({ username: 'alice', targetLang: 'en' })))
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await screen.findByRole('combobox')
  const ws = Socket.instances.at(-1)!
  const room = { id: 'r1', kind: 'private', name: 'bob', members: ['alice', 'bob'], creator: null }
  await act(async () => ws.onmessage?.({ data: JSON.stringify({
    type: 'init', me: 'alice', users: [], rooms: [room, { ...room, id: 'r2', name: 'carol' }], groups: [], unread: {},
  }) }))
  await userEvent.click(screen.getByRole('button', { name: /bob/ }))
  await act(async () => ws.onmessage?.({ data: JSON.stringify({
    type: 'history', roomId: 'r1', messages: [
      { id: 'm1', roomId: 'r1', sender: 'bob', text: 'Hello', ts: '2026-01-01T10:00:00Z' },
    ],
  }) }))
  expect(await screen.findByRole('button', { name: 'Translate' })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Read message aloud' }))
  await screen.findByRole('button', { name: 'Stop speech' })
  expect(fetch).toHaveBeenCalledWith('/api/ai/tts', expect.objectContaining({
    body: JSON.stringify({ text: 'Hello' }), headers: {
      Authorization: 'Bearer signed-jwt', 'Content-Type': 'application/json',
    },
  }))
  await userEvent.click(screen.getByRole('button', { name: /carol/ }))
  expect(pause).toHaveBeenCalledOnce()
  expect(revoke).toHaveBeenCalledWith('blob:speech')
})
