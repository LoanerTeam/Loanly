// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { TranslationTools, TranslateMessage } from './TranslationTools'
import { SpeakButton, SpeechTools } from '../tts/SpeechTools'

const speech = vi.hoisted(() => ({ createSpeech: vi.fn() }))
vi.mock('../tts/api', () => speech)

afterEach(() => { cleanup(); vi.unstubAllGlobals(); speech.createSpeech.mockReset() })
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body })
const view = (language = 'en') => render(<TranslationTools token="jwt" initialLanguage={language}>
  <TranslateMessage text="Hello" />
</TranslationTools>)

test('restores saved language and saves changes with bearer auth', async () => {
  const fetch = vi.fn().mockResolvedValue(response({ username: 'alice', targetLang: 'th' }))
  vi.stubGlobal('fetch', fetch)
  view('ja')
  expect(screen.getByRole('combobox')).toHaveProperty('value', 'ja')
  await userEvent.selectOptions(screen.getByRole('combobox'), 'th')
  expect(fetch).toHaveBeenCalledWith('/api/me', expect.objectContaining({
    method: 'PUT', headers: expect.objectContaining({ Authorization: 'Bearer jwt' }),
    body: JSON.stringify({ targetLang: 'th' }),
  }))
  expect(screen.getByRole('combobox')).toHaveProperty('value', 'th')
})

test('failed language save keeps the previous saved language', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  view('en')
  await userEvent.selectOptions(screen.getByRole('combobox'), 'th')
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole('combobox')).toHaveProperty('value', 'en')
})

test('translation is local, plain text, and duplicate requests are disabled', async () => {
  let finish!: (value: unknown) => void
  const fetch = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve }))
  vi.stubGlobal('fetch', fetch)
  view('th')
  await userEvent.click(screen.getByRole('button', { name: 'Translate' }))
  expect(screen.getByRole('button')).toHaveProperty('disabled', true)
  await userEvent.click(screen.getByRole('button'))
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith('/api/ai/translate', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ text: 'Hello', targetLang: 'th' }),
    headers: expect.objectContaining({ Authorization: 'Bearer jwt' }),
  }))
  finish(response({ translation: '<img src=x onerror=alert(1)>' }))
  expect(await screen.findByRole('status')).toHaveProperty('textContent', '<img src=x onerror=alert(1)>')
  expect(screen.queryByRole('img')).toBeNull()
})

test('shows quota failure and allows retry', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(response({ error: 'ai_quota', detail: 'Try again later.' }, 429))
    .mockResolvedValueOnce(response({ translation: 'สวัสดี' }))
  vi.stubGlobal('fetch', fetch)
  view('th')
  await userEvent.click(screen.getByRole('button'))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Try again later.')
  await userEvent.click(screen.getByRole('button', { name: 'Retry translation' }))
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'สวัสดี')
})

test('changing language discards late results from the previous language', async () => {
  let finish!: (value: unknown) => void
  const fetch = vi.fn()
    .mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce(response({ username: 'alice', targetLang: 'ja' }))
    .mockResolvedValueOnce(response({ translation: 'こんにちは' }))
  vi.stubGlobal('fetch', fetch)
  view('th')
  await userEvent.click(screen.getByRole('button'))
  await userEvent.selectOptions(screen.getByRole('combobox'), 'ja')
  await act(async () => { finish(response({ translation: 'old result' })) })
  expect(screen.queryByText('old result')).toBeNull()
  await userEvent.click(screen.getByRole('button'))
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'こんにちは')
})

test('translation stays in the requesting view and disappears on remount', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ translation: 'สวัสดี' })))
  const first = render(<section aria-label="Alice">
    <TranslationTools token="alice" initialLanguage="th"><TranslateMessage text="Hello" /></TranslationTools>
  </section>)
  render(<section aria-label="Bob">
    <TranslationTools token="bob" initialLanguage="en"><TranslateMessage text="Hello" /></TranslationTools>
  </section>)
  await userEvent.click(within(screen.getByRole('region', { name: 'Alice' })).getByRole('button'))
  expect(await within(screen.getByRole('region', { name: 'Alice' })).findByText('สวัสดี')).toBeTruthy()
  expect(within(screen.getByRole('region', { name: 'Bob' })).queryByText('สวัสดี')).toBeNull()
  first.unmount()
  view('th')
  expect(screen.queryByText('สวัสดี')).toBeNull()
})

function audioBrowser() {
  const players: { pause: ReturnType<typeof vi.fn> }[] = []
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:speech', revokeObjectURL: revoke })
  vi.stubGlobal('Audio', class {
    pause = vi.fn()
    play = vi.fn().mockResolvedValue(undefined)
    removeAttribute = vi.fn()
    load = vi.fn()
    constructor() { players.push(this) }
  })
  speech.createSpeech.mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }))
  return { players, revoke }
}

test('speaker after Translate reads the displayed translation and stops original speech', async () => {
  const { players } = audioBrowser()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ translation: 'สวัสดี' })))
  render(<SpeechTools><TranslationTools token="jwt" initialLanguage="th">
    <SpeakButton token="jwt" text="Hello" />
    <TranslateMessage text="Hello" />
  </TranslationTools></SpeechTools>)
  expect(screen.queryByRole('button', { name: 'Read translated message aloud' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Read message aloud' }))
  await screen.findByRole('button', { name: 'Stop speech' })
  await userEvent.click(screen.getByRole('button', { name: 'Translate' }))
  const translatedSpeaker = await screen.findByRole('button', { name: 'Read translated message aloud' })
  const translate = screen.getByRole('button', { name: 'Translate' })
  expect(translate.nextElementSibling?.contains(translatedSpeaker)).toBe(true)
  expect(translatedSpeaker.textContent).toBe('')
  expect(translatedSpeaker.querySelector('svg')).toBeTruthy()
  await userEvent.click(translatedSpeaker)
  await screen.findByRole('button', { name: 'Stop speech' })
  expect(speech.createSpeech.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    ['jwt', 'Hello'], ['jwt', 'สวัสดี'],
  ])
  expect(players[0].pause).toHaveBeenCalledOnce()
  expect(screen.getByRole('status').textContent).toBe('สวัสดี')
})

test('changing language cancels translated speech and ignores a late audio result', async () => {
  const { players } = audioBrowser()
  let finish!: (blob: Blob) => void
  speech.createSpeech.mockReturnValue(new Promise<Blob>((resolve) => { finish = resolve }))
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(response({ translation: 'สวัสดี' }))
    .mockResolvedValueOnce(response({ username: 'alice', targetLang: 'ja' })))
  view('th')
  await userEvent.click(screen.getByRole('button', { name: 'Translate' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Read translated message aloud' }))
  const signal = speech.createSpeech.mock.calls[0][2] as AbortSignal
  await userEvent.selectOptions(screen.getByRole('combobox'), 'ja')
  expect(signal.aborted).toBe(true)
  expect(screen.queryByRole('button', { name: 'Cancel speech' })).toBeNull()
  await act(async () => finish(new Blob(['wav'], { type: 'audio/wav' })))
  expect(players).toHaveLength(0)
})

test('retranslating stops old audio and the new speaker reads the updated translation', async () => {
  const { players, revoke } = audioBrowser()
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(response({ translation: 'first translation' }))
    .mockResolvedValueOnce(response({ translation: 'updated translation' })))
  view()
  await userEvent.click(screen.getByRole('button', { name: 'Translate' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Read translated message aloud' }))
  await screen.findByRole('button', { name: 'Stop speech' })
  await userEvent.click(screen.getByRole('button', { name: 'Translate' }))
  expect(players[0].pause).toHaveBeenCalledOnce()
  expect(revoke).toHaveBeenCalledOnce()
  await userEvent.click(await screen.findByRole('button', { name: 'Read translated message aloud' }))
  expect(speech.createSpeech.mock.calls.at(-1)?.[1]).toBe('updated translation')
})
