// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AuthApp, AuthForm } from './AuthApp'
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
  await user.type(screen.getByLabelText('Confirm password'), 'correct password')
  await user.click(screen.getByRole('button', { name: 'Register' }))
  expect((screen.getByRole('button', { name: 'Please wait…' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.submit(password.closest('form')!)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/register')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ username: 'alice', password: 'correct password' })
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

test('registration requires confirmation and blocks mismatches until both passwords match', async () => {
  fetchMock.mockResolvedValueOnce(response({ token: 'new-jwt' })).mockResolvedValueOnce(response(profile))
  renderApp()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Create an account' }))
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Password'), 'correct password')
  const confirmation = screen.getByLabelText('Confirm password') as HTMLInputElement
  expect(confirmation.required).toBe(true)
  expect(confirmation.autocomplete).toBe('new-password')
  await user.click(screen.getByRole('button', { name: 'Register' }))
  expect(fetchMock).not.toHaveBeenCalled()
  await user.type(confirmation, 'different password')
  await user.click(screen.getByRole('button', { name: 'Register' }))
  expect(screen.getByRole('alert').textContent).toBe('Passwords do not match.')
  expect(confirmation.getAttribute('aria-invalid')).toBe('true')
  expect(confirmation.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
  expect(fetchMock).not.toHaveBeenCalled()
  await user.clear(confirmation)
  await user.type(confirmation, 'correct password')
  expect(screen.queryByRole('alert')).toBeNull()
  // Editing the original password must revalidate the confirmation too.
  await user.type(screen.getByLabelText('Password'), '!')
  expect(screen.getByRole('alert').textContent).toBe('Passwords do not match.')
  await user.type(confirmation, '!')
  await user.click(screen.getByRole('button', { name: 'Register' }))
  expect(await screen.findByRole('region', { name: 'Chat' })).toBeTruthy()
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ username: 'alice', password: 'correct password!' })
})

test('eye buttons toggle each field independently without changing values or submitting', async () => {
  const onSubmit = vi.fn(async () => {})
  render(<AuthForm busy={false} error="" onSubmit={onSubmit} />)
  const user = userEvent.setup()
  const password = screen.getByLabelText('Password') as HTMLInputElement
  expect(screen.queryByLabelText('Confirm password')).toBeNull()
  await user.type(password, 'login password')
  await user.click(screen.getByRole('button', { name: 'Show password' }))
  expect(password.type).toBe('text')
  expect(password.value).toBe('login password')
  const hide = screen.getByRole('button', { name: 'Hide password' })
  expect(hide.getAttribute('aria-pressed')).toBe('true')
  expect(hide.getAttribute('aria-controls')).toBe(password.id)
  // Native buttons remain operable from the keyboard.
  await user.keyboard('{Enter}')
  expect(password.type).toBe('password')
  await user.click(screen.getByRole('button', { name: 'Create an account' }))
  const confirmation = screen.getByLabelText('Confirm password') as HTMLInputElement
  await user.type(password, 'register password')
  await user.type(confirmation, 'register password')
  await user.click(screen.getByRole('button', { name: 'Show confirm password' }))
  expect(confirmation.type).toBe('text')
  expect(password.type).toBe('password')
  await user.click(screen.getByRole('button', { name: 'Show password' }))
  expect(password.type).toBe('text')
  await user.click(screen.getByRole('button', { name: 'Hide confirm password' }))
  expect(confirmation.type).toBe('password')
  expect(confirmation.value).toBe('register password')
  expect(onSubmit).not.toHaveBeenCalled()
})

test('switching auth modes clears passwords, mismatch errors and visibility', async () => {
  render(<AuthForm busy={false} error="" onSubmit={vi.fn(async () => {})} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Create an account' }))
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Password'), 'correct password')
  await user.type(screen.getByLabelText('Confirm password'), 'different password')
  await user.click(screen.getByRole('button', { name: 'Show password' }))
  await user.click(screen.getByRole('button', { name: 'Show confirm password' }))
  await user.click(screen.getByRole('button', { name: 'Register' }))
  expect(screen.getByRole('alert')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Already registered? Sign in' }))
  expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password')
  expect(screen.queryByLabelText('Confirm password')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Create an account' }))
  expect((screen.getByLabelText('Confirm password') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('Confirm password') as HTMLInputElement).type).toBe('password')
})

test('failed registration clears and masks both password fields', async () => {
  fetchMock.mockResolvedValue(response({ error: 'name_taken', detail: 'That Username is already registered.' }, 409))
  renderApp()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Create an account' }))
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Password'), 'correct password')
  await user.type(screen.getByLabelText('Confirm password'), 'correct password')
  await user.click(screen.getByRole('button', { name: 'Show password' }))
  await user.click(screen.getByRole('button', { name: 'Show confirm password' }))
  await user.click(screen.getByRole('button', { name: 'Register' }))
  expect((await screen.findByRole('alert')).textContent).toContain('already registered')
  for (const label of ['Password', 'Confirm password']) {
    const input = screen.getByLabelText(label) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.type).toBe('password')
  }
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
