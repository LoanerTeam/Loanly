import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { UserList } from './UserList'
import { ConnectionStatus } from './ConnectionStatus'

test('renders own username, online/offline text and escapes usernames', () => {
  const html = renderToStaticMarkup(<UserList me="alice" users={[
    { username: 'alice', online: true }, { username: '<script>', online: false },
  ]} />)
  expect(html).toContain('alice')
  expect(html).toContain('(you)')
  expect(html).toContain('Online')
  expect(html).toContain('Offline')
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
})
test('reconnect warns that status may be stale and auth rejection asks for sign in', () => {
  expect(renderToStaticMarkup(<ConnectionStatus status="reconnecting" />)).toContain('out of date')
  expect(renderToStaticMarkup(<ConnectionStatus status="unauthorized" />)).toContain('sign in again')
})
