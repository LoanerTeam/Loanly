// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { apiRequest, onUnauthorized } from './api'

afterEach(() => vi.unstubAllGlobals())

test('supports cancellable binary responses alongside existing JSON requests', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response('wav', { headers: { 'Content-Type': 'audio/wav' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ username: 'alice' })))
  vi.stubGlobal('fetch', fetch)
  const controller = new AbortController()
  const audio = await apiRequest<Blob>('/ai/tts', {
    method: 'POST', token: 'jwt', body: { text: 'Hello' }, responseType: 'blob', signal: controller.signal,
  })
  expect(audio.type).toBe('audio/wav')
  expect(fetch).toHaveBeenCalledWith('/api/ai/tts', expect.objectContaining({ signal: controller.signal }))
  expect(await apiRequest('/me')).toEqual({ username: 'alice' })
})

test('binary requests retain auth failure handling', async () => {
  const listener = vi.fn()
  const unsubscribe = onUnauthorized(listener)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: 'invalid_token', detail: 'Please sign in again.',
  }), { status: 401 })))
  try {
    await expect(apiRequest('/ai/tts', { token: 'expired', responseType: 'blob' })).rejects.toThrow('Please sign in again.')
    expect(listener).toHaveBeenCalledWith('expired')
  } finally { unsubscribe() }
})

test('cancellation preserves AbortError instead of reporting a network failure', async () => {
  const controller = new AbortController()
  controller.abort()
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')))
  await expect(apiRequest('/ai/tts', { signal: controller.signal, responseType: 'blob' }))
    .rejects.toHaveProperty('name', 'AbortError')
})
