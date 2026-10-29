import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { GroupList } from './GroupList'
import { CreateGroupForm } from './CreateGroupForm'
const form = vi.hoisted(() => ({ draft: 'team', pending: null as string | null, connected: true, error: '', notice: '' }))
vi.mock('./useGroups', () => ({ useGroups: () => form }))
const noop = { onOpen: () => {}, onLeave: () => {}, onDelete: () => {} }

test('keeps identically named Groups separate and displays their Creators', () => {
  const html = renderToStaticMarkup(<GroupList me="carol" {...noop} groups={[
    { id: '1', kind: 'group', name: 'test', creator: 'alice', members: ['alice'] },
    { id: '2', kind: 'group', name: 'test', creator: 'bob', members: ['bob'] },
  ]} />)
  expect(html.match(/<h3\b/g)).toHaveLength(2)
  expect(html).toContain('Creator: alice')
  expect(html).toContain('Creator: bob')
})

test('renders Group names, Creator and members as escaped text', () => {
  const html = renderToStaticMarkup(<GroupList me="alice" {...noop} groups={[
    { id: '1', kind: 'group', name: '<script>', creator: 'alice', members: ['alice', 'bob'] },
  ]} />)
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).toContain('Creator: alice (you)')
  expect(html).toContain('Members: alice, bob')
  expect(renderToStaticMarkup(<GroupList me="bob" {...noop} groups={[]} />)).toContain('No Groups yet.')
})
const team = { id: 't', kind: 'group' as const, name: 'team', creator: 'alice', members: ['alice'] }
test('non-Members see Join, Members see Open; Join is disabled while joining or disconnected', () => {
  const join = renderToStaticMarkup(<GroupList me="bob" {...noop} groups={[team]} />)
  expect(join).toContain('>Join</button>')
  expect(join).not.toContain('disabled=""')
  expect(renderToStaticMarkup(<GroupList me="alice" {...noop} groups={[team]} />)).toContain('>Open</button>')
  const joining = renderToStaticMarkup(<GroupList me="bob" joining="t" {...noop} groups={[team]} />)
  expect(joining).toContain('Joining…')
  expect(joining).toContain('disabled=""')
  expect(renderToStaticMarkup(<GroupList me="bob" connected={false} {...noop} groups={[team]} />)).toContain('disabled=""')
})
test('Leave shows for Members, Delete for the Creator, neither for non-Members', () => {
  const group = { ...team, members: ['alice', 'bob'] }
  const creator = renderToStaticMarkup(<GroupList me="alice" {...noop} groups={[group]} />)
  expect(creator).toContain('>Delete</button>')
  expect(creator).not.toContain('Leave')
  const member = renderToStaticMarkup(<GroupList me="bob" {...noop} groups={[group]} />)
  expect(member).toContain('>Leave</button>')
  expect(member).not.toContain('Delete')
  const outsider = renderToStaticMarkup(<GroupList me="carol" {...noop} groups={[group]} />)
  expect(outsider).not.toContain('Leave')
  expect(outsider).not.toContain('Delete')
})
test('pending leave or delete disables the buttons and the error is announced', () => {
  const group = { ...team, members: ['alice', 'bob'] }
  const leaving = renderToStaticMarkup(<GroupList me="bob" acting="t" error="Could not leave" {...noop} groups={[group]} />)
  expect(leaving).toContain('Leaving…')
  expect(leaving).toContain('disabled=""')
  expect(leaving).toContain('role="alert"')
  expect(renderToStaticMarkup(<GroupList me="alice" acting="t" {...noop} groups={[group]} />)).toContain('Deleting…')
  expect(renderToStaticMarkup(<GroupList me="alice" connected={false} {...noop} groups={[group]} />)).toContain('disabled=""')
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
