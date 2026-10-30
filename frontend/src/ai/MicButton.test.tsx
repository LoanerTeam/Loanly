// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from '../features/auth/api'
import { MessageInput } from '../features/chat/MessageInput'
import { MicButton, pickMimeType } from './MicButton'

const api = vi.hoisted(() => ({ transcribeAudio: vi.fn() }))
vi.mock('./api', () => api)

const stopTrack = vi.fn()
class FakeRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm'
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(public stream: MediaStream) {}
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['voice']) })
    this.onstop?.()
  }
}

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); api.transcribeAudio.mockReset(); stopTrack.mockReset() })

test('picks the first recording format the browser supports, or none', () => {
  expect(pickMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4')
  expect(pickMimeType((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
  expect(pickMimeType(() => false)).toBe('')
})

test('records, uploads the audio and hands the transcript to the chat box', async () => {
  api.transcribeAudio.mockResolvedValue({ text: 'hello world' })
  const onText = vi.fn()
  render(<MicButton token="tok" onText={onText} />)
  await userEvent.click(screen.getByRole('button', { name: 'Record a message' }))
  const stop = await screen.findByRole('button', { name: 'Stop recording' })
  expect(stop.getAttribute('aria-pressed')).toBe('true')
  await userEvent.click(stop)
  await waitFor(() => expect(onText).toHaveBeenCalledWith('hello world'))
  const [token, blob] = api.transcribeAudio.mock.calls[0]
  expect(token).toBe('tok')
  expect((blob as Blob).type).toBe('audio/webm')
  expect(stopTrack).toHaveBeenCalled() // microphone released
  expect(await screen.findByRole('button', { name: 'Record a message' })).toBeTruthy()
})

test('shows the server message when transcription fails and does not touch the chat box', async () => {
  api.transcribeAudio.mockRejectedValue(new ApiError(422, 'no_speech', 'No speech was detected.'))
  const onText = vi.fn()
  render(<MicButton token="tok" onText={onText} />)
  await userEvent.click(screen.getByRole('button', { name: 'Record a message' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
  expect((await screen.findByRole('alert')).textContent).toContain('No speech was detected.')
  expect(onText).not.toHaveBeenCalled()
})

test('explains a blocked microphone and an unsupported or insecure browser', async () => {
  const getUserMedia = vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'))
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  render(<MicButton token="tok" onText={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Record a message' }))
  expect((await screen.findByRole('alert')).textContent).toContain('blocked')
  cleanup()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
  render(<MicButton token="tok" onText={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Record a message' }))
  expect((await screen.findByRole('alert')).textContent).toContain('HTTPS or localhost')
})

test('a transcript is inserted for editing and is never sent automatically', async () => {
  const onSend = vi.fn().mockReturnValue(true)
  api.transcribeAudio.mockResolvedValue({ text: 'spoken words' })
  render(<MessageInput onSend={onSend} renderExtra={(insert) => <MicButton token="tok" onText={insert} />} />)
  const box = screen.getByLabelText('Message') as HTMLInputElement
  await userEvent.type(box, 'typed')
  await userEvent.click(screen.getByRole('button', { name: 'Record a message' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
  await waitFor(() => expect(box.value).toBe('typed spoken words'))
  expect(onSend).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(onSend).toHaveBeenCalledWith('typed spoken words')
})
