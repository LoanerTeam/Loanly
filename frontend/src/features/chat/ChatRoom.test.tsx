import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { UserList } from '../presence/UserList'
import { ChatRoom } from './ChatRoom'
import { RoomList } from './RoomList'

const room = { id: 'r1', kind: 'private' as const, name: 'bob', members: ['alice', 'bob'], creator: null }
const message = (sender: string, text: string) => ({ id: sender + text, roomId: 'r1', sender, text, ts: '2026-01-01T10:00:00Z' })

test('unread divider and per-message actions render together', () => {
  const unread = message('bob', 'hello')
  const html = renderToStaticMarkup(
    <ChatRoom room={room} me="alice" onSend={() => true} messages={[unread]}
      firstUnreadId={unread.id} messageActions={(entry) => <button>Translate {entry.text}</button>} />,
  )
  expect(html).toContain('aria-label="Unread messages"')
  expect(html).toContain('Translate hello')
  expect(html.indexOf('aria-label="Unread messages"')).toBeLessThan(html.indexOf('Translate hello'))
})

test('speaker slot precedes both own and incoming message bubbles', () => {
  const html = renderToStaticMarkup(
    <ChatRoom room={room} me="alice" onSend={() => true}
      messages={[message('alice', 'own text'), message('bob', 'incoming text')]}
      messageLeading={(entry) => <button aria-label={`Read ${entry.sender}`} />}
      messageActions={() => <button>Translate</button>} />,
  )
  for (const [sender, text] of [['alice', 'own text'], ['bob', 'incoming text']]) {
    expect(html.indexOf(`aria-label="Read ${sender}"`)).toBeLessThan(html.indexOf(`>${text}</p>`))
  }
})

test('chat room has a message window and a chat box, and shows incoming and own messages', () => {
  const html = renderToStaticMarkup(
    <ChatRoom room={room} me="alice" onSend={() => true} messages={[message('bob', 'hello'), message('alice', 'hi bob')]} />,
  )
  expect(html).toContain('aria-label="Messages"')
  expect(html).toContain('aria-label="Message"') // the chat box
  expect(html).toContain('hello')
  expect(html).toContain('hi bob')
})

test('message text is escaped, never interpreted as HTML', () => {
  const html = renderToStaticMarkup(
    <ChatRoom room={room} me="alice" onSend={() => true} messages={[message('bob', '<img src=x onerror=alert(1)>')]} />,
  )
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  expect(html).not.toContain('<img')
})

test('empty room invites the first message; error is announced', () => {
  const html = renderToStaticMarkup(<ChatRoom room={room} me="alice" onSend={() => true} messages={[]} error="Could not send." />)
  expect(html).toContain('No messages yet')
  expect(html).toContain('role="alert"')
})

test('room list marks the active chat; user list is clickable for others but not yourself', () => {
  const rooms = renderToStaticMarkup(<RoomList rooms={[room]} activeId="r1" onSelect={() => {}} />)
  expect(rooms).toContain('aria-current="true"')
  const users = renderToStaticMarkup(
    <UserList me="alice" onSelect={() => {}} users={[{ username: 'alice', online: true }, { username: 'bob', online: false }]} />,
  )
  expect(users.match(/<button/g)).toHaveLength(1)
})
