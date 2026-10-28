import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { clearDevSession, readDevSession, saveDevSession } from './session'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
})
afterEach(() => vi.unstubAllGlobals())

test('restores a saved username after reloading the module', async () => {
  expect(readDevSession()).toBe('')
  saveDevSession('alice')
  vi.resetModules()
  const reloaded = await import('./session')
  expect(reloaded.readDevSession()).toBe('alice')
})

test('explicit disconnect removes the saved username', () => {
  saveDevSession('bob')
  clearDevSession()
  expect(readDevSession()).toBe('')
})

test('ignores invalid saved usernames', () => {
  saveDevSession('invalid username')
  expect(readDevSession()).toBe('')
})

test('unavailable browser storage does not break connecting or disconnecting', () => {
  vi.stubGlobal('sessionStorage', {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
    removeItem: () => { throw new Error('blocked') },
  })
  expect(readDevSession()).toBe('')
  expect(() => saveDevSession('alice')).not.toThrow()
  expect(() => clearDevSession()).not.toThrow()
})
