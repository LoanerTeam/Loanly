// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SpeakButton, SpeechTools } from './SpeechTools'

const api = vi.hoisted(() => ({ createSpeech: vi.fn() }))
vi.mock('./api', () => api)

class AudioMock {
  static instances: AudioMock[] = []
  static rejection: Error | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  pause = vi.fn()
  load = vi.fn()
  removeAttribute = vi.fn()
  play = vi.fn(() => AudioMock.rejection ? Promise.reject(AudioMock.rejection) : Promise.resolve())
  constructor(public src: string) { AudioMock.instances.push(this) }
}
const createUrl = vi.fn(() => 'blob:speech')
const revokeUrl = vi.fn()
const blob = () => new Blob(['wav'], { type: 'audio/wav' })

beforeEach(() => {
  AudioMock.instances = []; AudioMock.rejection = null
  vi.stubGlobal('Audio', AudioMock)
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl })
  api.createSpeech.mockResolvedValue(blob())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

function buttons() {
  return <SpeechTools><SpeakButton token="jwt" text="Hello" /><SpeakButton token="jwt" text="สวัสดี" /></SpeechTools>
}

test('shows loading, sends original text and plays WAV; stop releases audio', async () => {
  let resolve!: (audio: Blob) => void
  api.createSpeech.mockReturnValue(new Promise<Blob>((done) => { resolve = done }))
  render(buttons())
  await userEvent.click(screen.getAllByRole('button', { name: 'Read message aloud' })[0])
  expect(screen.getByRole('button', { name: 'Cancel speech' }).textContent).toBe('')
  expect(screen.getByRole('status').textContent).toContain('Creating speech')
  expect(api.createSpeech).toHaveBeenCalledWith('jwt', 'Hello', expect.any(AbortSignal))
  await act(async () => resolve(blob()))
  await userEvent.click(await screen.findByRole('button', { name: 'Stop speech' }))
  expect(AudioMock.instances[0].play).toHaveBeenCalledOnce()
  expect(AudioMock.instances[0].pause).toHaveBeenCalledOnce()
  expect(revokeUrl).toHaveBeenCalledWith('blob:speech')
})

test('only one message plays at a time and ended resets its button', async () => {
  render(buttons())
  await userEvent.click(screen.getAllByRole('button', { name: 'Read message aloud' })[0])
  await screen.findByRole('button', { name: 'Stop speech' })
  await userEvent.click(screen.getByRole('button', { name: 'Read message aloud' }))
  await waitFor(() => expect(AudioMock.instances).toHaveLength(2))
  expect(AudioMock.instances[0].pause).toHaveBeenCalledOnce()
  await act(async () => AudioMock.instances[1].onended?.())
  expect(screen.getAllByRole('button', { name: 'Read message aloud' })).toHaveLength(2)
})

test('cancel aborts the request and ignores its late result', async () => {
  let resolve!: (audio: Blob) => void
  api.createSpeech.mockReturnValue(new Promise<Blob>((done) => { resolve = done }))
  render(buttons())
  await userEvent.click(screen.getAllByRole('button', { name: 'Read message aloud' })[0])
  const signal = api.createSpeech.mock.calls[0][2] as AbortSignal
  await userEvent.click(screen.getByRole('button', { name: 'Cancel speech' }))
  expect(signal.aborted).toBe(true)
  await act(async () => resolve(blob()))
  expect(AudioMock.instances).toHaveLength(0)
  expect(screen.queryByRole('alert')).toBeNull()
})

test('selecting another message aborts the first request and ignores an obsolete failure', async () => {
  let reject!: (error: Error) => void
  api.createSpeech.mockReturnValueOnce(new Promise<Blob>((_, fail) => { reject = fail }))
  render(buttons())
  await userEvent.click(screen.getAllByRole('button', { name: 'Read message aloud' })[0])
  const signal = api.createSpeech.mock.calls[0][2] as AbortSignal
  await userEvent.click(screen.getByRole('button', { name: 'Read message aloud' }))
  await screen.findByRole('button', { name: 'Stop speech' })
  expect(signal.aborted).toBe(true)
  await act(async () => reject(new Error('obsolete quota failure')))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(AudioMock.instances).toHaveLength(1)
})

test('changing room or logging out cancels pending audio and releases playing audio', async () => {
  const mounted = render(<SpeechTools key="room1"><SpeakButton token="jwt" text="Hello" /></SpeechTools>)
  await userEvent.click(screen.getByRole('button', { name: 'Read message aloud' }))
  await screen.findByRole('button', { name: 'Stop speech' })
  mounted.rerender(<SpeechTools key="room2"><SpeakButton token="jwt" text="Other" /></SpeechTools>)
  expect(AudioMock.instances[0].pause).toHaveBeenCalledOnce()
  expect(revokeUrl).toHaveBeenCalledOnce()
  let resolve!: (audio: Blob) => void
  api.createSpeech.mockReturnValue(new Promise<Blob>((done) => { resolve = done }))
  await userEvent.click(screen.getByRole('button', { name: 'Read message aloud' }))
  const signal = api.createSpeech.mock.calls.at(-1)![2] as AbortSignal
  mounted.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => resolve(blob()))
  expect(AudioMock.instances).toHaveLength(1)
})

test('server failures allow retry without changing message content', async () => {
  api.createSpeech.mockRejectedValueOnce(new Error('The AI quota is used up for now.'))
  render(buttons())
  await userEvent.click(screen.getAllByRole('button', { name: 'Read message aloud' })[0])
  expect((await screen.findByRole('alert')).textContent).toContain('quota')
  await userEvent.click(screen.getByRole('button', { name: 'Retry speech' }))
  expect(await screen.findByRole('button', { name: 'Stop speech' })).toBeTruthy()
})

test('playback blocked or decoding failed is friendly and releases the Blob', async () => {
  AudioMock.rejection = new DOMException('blocked', 'NotAllowedError')
  render(buttons())
  await userEvent.click(screen.getAllByRole('button', { name: 'Read message aloud' })[0])
  expect((await screen.findByRole('alert')).textContent).toContain('playback was blocked')
  expect(revokeUrl).toHaveBeenCalledOnce()
  AudioMock.rejection = null
  await userEvent.click(screen.getByRole('button', { name: 'Retry speech' }))
  await screen.findByRole('button', { name: 'Stop speech' })
  await act(async () => AudioMock.instances.at(-1)!.onerror?.())
  expect((await screen.findByRole('alert')).textContent).toContain('Could not play speech')
})

test('rejects an empty or non-audio server response', async () => {
  api.createSpeech.mockResolvedValue(new Blob(['oops'], { type: 'application/json' }))
  render(buttons())
  await userEvent.click(screen.getAllByRole('button', { name: 'Read message aloud' })[0])
  expect((await screen.findByRole('alert')).textContent).toContain('Could not create speech')
  expect(AudioMock.instances).toHaveLength(0)
})
