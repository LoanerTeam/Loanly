// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { TranslationTools, TranslateMessage } from './TranslationTools'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
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
