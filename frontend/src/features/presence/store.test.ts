import { beforeEach, expect, test, vi } from 'vitest'
import { dispatch } from '../../ws/client'
import { getPresence, resetPresence, subscribePresence } from './store'

beforeEach(resetPresence)
function frame(value: unknown) { dispatch(JSON.stringify(value)) }
test('snapshot replaces users, includes self, sorts online first and presence upserts', () => {
  frame({ type: 'init', me: 'alice', users: [
    { username: 'bob', online: false }, { username: 'alice', online: true },
  ] })
  frame({ type: 'presence', username: 'bob', online: true })
  frame({ type: 'presence', username: 'carol', online: false })
  frame({ type: 'presence', username: 'bob', online: true })
  expect(getPresence()).toEqual({ me: 'alice', users: [
    { username: 'alice', online: true }, { username: 'bob', online: true },
    { username: 'carol', online: false },
  ] })
  frame({ type: 'init', me: 'alice', users: [{ username: 'alice', online: true }] })
  expect(getPresence().users).toHaveLength(1)
})
test('ignores invalid user payloads and unsubscribes cleanly', () => {
  const listener = vi.fn(), off = subscribePresence(listener)
  frame({ type: 'init', me: 'alice', users: [{ username: 'alice', online: 'yes' }] })
  frame({ type: 'presence', username: 'bob' })
  expect(listener).not.toHaveBeenCalled()
  frame({ type: 'presence', username: 'bob', online: false })
  expect(listener).toHaveBeenCalledOnce()
  off()
  resetPresence()
  expect(listener).toHaveBeenCalledOnce()
})
