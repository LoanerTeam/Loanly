// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiError } from '../features/auth/api'
import { RoomAiBar } from './RoomAiBar'

const api = vi.hoisted(() => ({ summarizeUnread: vi.fn() }))
vi.mock('./api', () => api)
afterEach(() => { cleanup(); api.summarizeUnread.mockReset() })

const room = { id: 'g1', kind: 'group' as const, name: 'team', members: ['alice', 'bob'], creator: 'alice' }
const msg = (id: string, sender: string) => ({ id, roomId: 'g1', sender, text: `text ${id}`, ts: '2026-01-01T00:00:00Z' })
const messages = [msg('m1', 'alice'), msg('m2', 'bob'), msg('m3', 'bob')]
const bar = (catchUp: { roomId: string; count: number; lastId: string } | null) =>
  render(<RoomAiBar room={room} messages={messages} me="alice" catchUp={catchUp} token="tok" />)

test('hidden when the room had no Unread Messages', () => {
  bar(null)
  expect(screen.queryByRole('button')).toBeNull()
  cleanup(); bar({ roomId: 'g1', count: 0, lastId: 'm3' })
  expect(screen.queryByRole('button')).toBeNull()
  cleanup(); bar({ roomId: 'other', count: 2, lastId: 'm3' })
  expect(screen.queryByRole('button')).toBeNull()
})

test('summarizes exactly the Unread Messages and shows the summary', async () => {
  let finish: (value: { summary: string }) => void = () => {}
  api.summarizeUnread.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  bar({ roomId: 'g1', count: 2, lastId: 'm3' })
  await userEvent.click(screen.getByRole('button', { name: 'Summarize 2 unread' }))
  expect(api.summarizeUnread).toHaveBeenCalledWith('tok', 'team', [
    { sender: 'bob', text: 'text m2' }, { sender: 'bob', text: 'text m3' },
  ])
  expect(screen.getByRole('button', { name: 'Summarizing…' })).toHaveProperty('disabled', true)
  finish({ summary: 'Bob sent two messages.' })
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Bob sent two messages.')
})

test('shows a friendly error and keeps the button usable', async () => {
  api.summarizeUnread.mockRejectedValue(new ApiError(429, 'ai_quota', 'The AI quota is used up for now. Try again later.'))
  bar({ roomId: 'g1', count: 1, lastId: 'm3' })
  await userEvent.click(screen.getByRole('button', { name: 'Summarize 1 unread' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The AI quota is used up for now. Try again later.')
  expect(screen.getByRole('button', { name: 'Summarize 1 unread' })).toHaveProperty('disabled', false)
})

test('labels a capped request with the full unread count', () => {
  const many = Array.from({ length: 205 }, (_, i) => msg(`m${i}`, 'bob'))
  render(<RoomAiBar room={room} messages={many} me="alice" catchUp={{ roomId: 'g1', count: 205, lastId: 'm204' }} token="tok" />)
  expect(screen.getByRole('button', { name: 'Summarize latest 200 of 205 unread' })).toBeTruthy()
})
