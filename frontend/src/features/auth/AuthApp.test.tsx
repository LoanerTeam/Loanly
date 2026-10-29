// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AuthApp } from './AuthApp'
import { apiRequest } from './api'
import { readToken, saveToken } from './session'
import { createAuthStore } from './store'
import { connect, dispatch, disconnect } from '../../ws/client'
import { getPresence } from '../presence/store'
import { getGroups } from '../groups/store'
import { getChat } from '../chat/store'

const fetchMock = vi.fn()
const profile = { username: 'alice', targetLang: 'en' }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }) }
function Chat({ token, logout }: { token: string; logout: () => void }) {
  return <section aria-label="Chat"><p>{token}</p><button onClick={logout}>Log out</button></section>
}
const renderApp = () => render(<StrictMode><AuthApp renderChat={(token, logout) =>
  <Chat token={token} logout={logout} />} /></StrictMode>)

beforeEach(() => {
  sessionStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); disconnect(); fetchMock.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('guard hides chat until a stored token has been verified, including StrictMode remounts', async () => {
  saveToken('stored-jwt')
  let resolve!: (value: Response) => void
  fetchMock.mockImplementation(() => new Promise<Response>((done) => { resolve = done }))
  renderApp()
  expect(screen.getByRole('status').textContent).toContain('Checking')
  expect(screen.queryByRole('region', { name: 'Chat' })).toBeNull()
  await act(async () => resolve(response(profile)))
  expect(await screen.findByRole('region', { name: 'Chat' })).toBeTruthy()
  expect(fetchMock.mock.calls.at(-1)?.[1].headers.Authorization).toBe('Bearer stored-jwt')
})

test('login stores JWT, verifies profile and opens chat; logout removes token', async () => {
  fetchMock.mockResolvedValueOnce(response({ token: 'signed-jwt' })).mockResolvedValueOnce(response(profile))
  renderApp()
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Password'), 'correct password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByRole('region', { name: 'Chat' })).toBeTruthy()
  expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/login')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ username: 'alice', password: 'correct password' })
  expect(readToken()).toBe('signed-jwt')
  await user.click(screen.getByRole('button', { name: 'Log out' }))
  expect(screen.queryByRole('region', { name: 'Chat' })).toBeNull()
  expect(readToken()).toBe('')
})

test('register uses its endpoint, masks passwords, and prevents duplicate submissions while pending', async () => {
  let resolve!: (value: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
    .mockResolvedValueOnce(response(profile))
  renderApp()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Create an account' }))
  const password = screen.getByLabelText('Password') as HTMLInputElement
  expect(password.type).toBe('password')
  expect(password.autocomplete).toBe('new-password')
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(password, 'correct password')
  await user.click(screen.getByRole('button', { name: 'Register' }))
  expect((screen.getByRole('button', { name: 'Please wait…' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.submit(password.closest('form')!)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/register')
  await act(async () => resolve(response({ token: 'new-jwt' }, 201)))
  expect(await screen.findByRole('region', { name: 'Chat' })).toBeTruthy()
})

test('credential errors keep chat guarded and clear the entered password', async () => {
  fetchMock.mockResolvedValue(response({ error: 'invalid_credentials', detail: 'Incorrect Username or Password.' }, 401))
  renderApp()
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Password'), 'wrong password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Incorrect')
  expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
  expect(screen.queryByRole('region', { name: 'Chat' })).toBeNull()
  expect(readToken()).toBe('')
})

test('expired stored token returns to sign in and is removed', async () => {
  saveToken('expired')
  fetchMock.mockImplementation(async () => response({ error: 'invalid_token', detail: 'Please sign in again.' }, 401))
  renderApp()
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy()
  expect(readToken()).toBe('')
  expect(screen.queryByRole('region', { name: 'Chat' })).toBeNull()
})

test('temporary network failure keeps saved JWT and allows retry without showing chat', async () => {
  saveToken('valid-jwt')
  fetchMock.mockRejectedValue(new TypeError('offline'))
  renderApp()
  expect((await screen.findByRole('alert')).textContent).toContain('connection')
  expect(readToken()).toBe('valid-jwt')
  expect(screen.queryByRole('region', { name: 'Chat' })).toBeNull()
  fetchMock.mockResolvedValue(response(profile))
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('region', { name: 'Chat' })).toBeTruthy()
})

test('a late verification response cannot log the user back in after logout', async () => {
  saveToken('old-jwt')
  let resolve!: (value: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
  const store = createAuthStore()
  const pending = store.restore()
  store.logout()
  resolve(response(profile))
  await pending
  expect(store.getSnapshot().status).toBe('anonymous')
  expect(readToken()).toBe('')
})

test('protected REST 401 signs out and clears previous account data', async () => {
  saveToken('valid-jwt')
  fetchMock.mockImplementation(async () => response(profile))
  const store = createAuthStore()
  const stop = store.start()
  try {
    await waitFor(() => expect(store.getSnapshot().status).toBe('authenticated'))
    dispatch(JSON.stringify({ type: 'init', me: 'alice', users: [{ username: 'bob', online: true }],
      rooms: [], groups: [{ id: 'g', kind: 'group', name: 'team', members: ['alice'], creator: 'alice' }], unread: {} }))
    expect(getPresence().me).toBe('alice')
    fetchMock.mockResolvedValueOnce(response({ error: 'invalid_token' }, 401))
    await expect(apiRequest('/me', { token: 'valid-jwt' })).rejects.toThrow()
    expect(store.getSnapshot().status).toBe('anonymous')
    expect(readToken()).toBe('')
    expect(getPresence().users).toEqual([])
    expect(getGroups().groups).toEqual([])
    expect(getChat().rooms).toEqual([])
  } finally { stop() }
})

test('WebSocket 4401 signs out instead of leaving an authenticated screen', async () => {
  class Socket {
    static instance: Socket
    onclose: ((event: { code: number }) => void) | null = null
    close() {}
    constructor() { Socket.instance = this }
  }
  vi.stubGlobal('WebSocket', Socket)
  saveToken('valid-jwt')
  fetchMock.mockImplementation(async () => response(profile))
  const store = createAuthStore()
  const stop = store.start()
  try {
    await waitFor(() => expect(store.getSnapshot().status).toBe('authenticated'))
    connect('valid-jwt')
    Socket.instance.onclose?.({ code: 4401 })
    expect(store.getSnapshot().status).toBe('anonymous')
    expect(readToken()).toBe('')
  } finally { stop() }
})

test('blocked browser storage still permits sign in and logout in memory', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
  fetchMock.mockResolvedValueOnce(response({ token: 'jwt' })).mockResolvedValueOnce(response(profile))
  const store = createAuthStore()
  await store.submit('login', 'alice', 'password')
  expect(store.getSnapshot().status).toBe('authenticated')
  store.logout()
  expect(store.getSnapshot().status).toBe('anonymous')
})

test('a late REST 401 for an old token cannot sign out the current account', async () => {
  saveToken('current-jwt')
  fetchMock.mockImplementation(async () => response(profile))
  const store = createAuthStore()
  const stop = store.start()
  try {
    await waitFor(() => expect(store.getSnapshot().status).toBe('authenticated'))
    fetchMock.mockResolvedValueOnce(response({ error: 'invalid_token' }, 401))
    await expect(apiRequest('/me', { token: 'old-jwt' })).rejects.toThrow()
    expect(store.getSnapshot().status).toBe('authenticated')
    expect(readToken()).toBe('current-jwt')
  } finally { stop() }
})
