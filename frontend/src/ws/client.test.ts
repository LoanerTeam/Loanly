import { expect, test, vi } from 'vitest'
import { dispatch, on } from './client'

test('dispatch calls listeners registered for the frame type only', () => {
  const a = vi.fn()
  const b = vi.fn()
  on('message.new', a)
  on('presence', b)
  dispatch(JSON.stringify({ type: 'message.new', message: { id: '1' } }))
  expect(a).toHaveBeenCalledOnce()
  expect(b).not.toHaveBeenCalled()
})
