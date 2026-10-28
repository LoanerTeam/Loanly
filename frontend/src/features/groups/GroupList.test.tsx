import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { GroupList } from './GroupList'
import { CreateGroupForm } from './CreateGroupForm'
const form = vi.hoisted(() => ({ draft: 'team', pending: null as string | null, connected: true, error: '', notice: '' }))
vi.mock('./useGroups', () => ({ useGroups: () => form }))

test('keeps identically named Groups separate and displays their Creators', () => {
  const html = renderToStaticMarkup(<GroupList me="carol" groups={[
    { id: '1', kind: 'group', name: 'test', creator: 'alice', members: ['alice'] },
    { id: '2', kind: 'group', name: 'test', creator: 'bob', members: ['bob'] },
  ]} />)
  expect(html.match(/<h3\b/g)).toHaveLength(2)
  expect(html).toContain('Creator: alice')
  expect(html).toContain('Creator: bob')
})

test('renders Group names, Creator and members as escaped text', () => {
  const html = renderToStaticMarkup(<GroupList me="alice" groups={[
    { id: '1', kind: 'group', name: '<script>', creator: 'alice', members: ['alice', 'bob'] },
  ]} />)
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).toContain('Creator: alice (you)')
  expect(html).toContain('Members: alice, bob')
  expect(renderToStaticMarkup(<GroupList me="bob" groups={[]} />)).toContain('No Groups yet.')
})
test('form disables submission when pending or disconnected and displays accessible feedback', () => {
  form.connected = false
  expect(renderToStaticMarkup(<CreateGroupForm />)).toContain('disabled=""')
  form.connected = true; form.pending = 'request'; form.error = 'Name taken'; form.notice = 'Unconfirmed'
  const html = renderToStaticMarkup(<CreateGroupForm />)
  expect(html).toContain('Creating…')
  expect(html).toContain('role="alert"')
  expect(html).toContain('Name taken')
  expect(html).toContain('role="status"')
})
