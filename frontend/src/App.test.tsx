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
