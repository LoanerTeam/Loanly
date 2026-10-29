// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ChatRoom } from './ChatRoom'

const room = { id: 'r1', kind: 'private' as const, name: 'bob', members: ['alice', 'bob'], creator: null }
const msg = (id: string, sender = 'bob') => ({ id, roomId: 'r1', sender, text: `text ${id}`, ts: '2026-01-01T10:00:00Z' })
const history = [msg('m1'), msg('m2', 'alice'), msg('m3'), msg('m4')]
let scrolled: Element[] = []
beforeEach(() => {
  scrolled = []
  // jsdom has no layout; record which element each scroll targets.
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this) })
})
afterEach(cleanup)

const view = (messages = history, firstUnreadId = '') =>
  <ChatRoom room={room} me="alice" onSend={() => true} messages={messages} firstUnreadId={firstUnreadId} />
const last = () => scrolled[scrolled.length - 1]
function scrollUp() {
  const list = screen.getByRole('list', { name: 'Messages' })
  Object.defineProperties(list, { scrollHeight: { value: 1000, configurable: true },
    clientHeight: { value: 300, configurable: true }, scrollTop: { value: 100, configurable: true } })
  fireEvent.scroll(list)
}

test('places a thin Unread divider right above the oldest Unread Message', () => {
  render(view(history, 'm3'))
  const items = screen.getByRole('list', { name: 'Messages' }).children
  const divider = screen.getByRole('separator', { name: 'Unread messages' })
  expect(divider.textContent).toBe('Unread')
  expect(items[2]).toBe(divider)
  expect(items[3].textContent).toContain('text m3')
  expect(screen.getAllByRole('separator')).toHaveLength(1)
})

test('no divider when nothing was Unread', () => {
  render(view(history))
  expect(screen.queryByRole('separator')).toBeNull()
})

test('opens at the divider instead of the newest message', () => {
  render(view(history, 'm3'))
  expect(last()).toBe(screen.getByRole('separator'))
})

test('the divider arriving after the history still moves the view to it', () => {
  const { rerender } = render(view(history))
  rerender(view(history, 'm3'))
  expect(last()).toBe(screen.getByRole('separator'))
})

test('a reader scrolled up is not pulled down by new messages from others', () => {
  const { rerender } = render(view(history, 'm3'))
  scrollUp()
  const before = scrolled.length
  rerender(view([...history, msg('m5')], 'm3'))
  expect(scrolled).toHaveLength(before)
})

test('own messages and readers at the bottom follow to the newest message', () => {
  const { rerender } = render(view(history, 'm3'))
  scrollUp()
  rerender(view([...history, msg('m5', 'alice')], 'm3'))
  expect(last()).not.toBe(screen.getByRole('separator'))
  expect(last().getAttribute('aria-hidden')).toBe('true') // the end-of-list anchor
  cleanup(); scrolled = []
  const second = render(view(history))
  second.rerender(view([...history, msg('m5')]))
  expect(last().getAttribute('aria-hidden')).toBe('true')
})
