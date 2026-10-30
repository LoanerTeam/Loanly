// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { onUnauthorized } from '../auth/api'
import { createSpeech } from './api'

afterEach(() => vi.unstubAllGlobals())

test('fetches a WAV Blob using authenticated REST with cancellation', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('wav', { headers: { 'Content-Type': 'audio/wav' } }))
  vi.stubGlobal('fetch', fetch)
  const controller = new AbortController()
  const audio = await createSpeech('jwt', 'สวัสดี', controller.signal)
  expect(audio.type).toBe('audio/wav')
  expect(audio.size).toBe(3)
  expect(fetch).toHaveBeenCalledWith('/api/ai/tts', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ text: 'สวัสดี' }), signal: controller.signal,
    headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' },
  }))
})

test('401 notifies the existing auth flow and preserves friendly REST errors', async () => {
  const listener = vi.fn()
  const unsubscribe = onUnauthorized(listener)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: 'invalid_token', detail: 'Please sign in again.',
  }), { status: 401 })))
  try {
    await expect(createSpeech('expired', 'hi', new AbortController().signal)).rejects.toThrow('Please sign in again.')
    expect(listener).toHaveBeenCalledWith('expired')
  } finally { unsubscribe() }
})
