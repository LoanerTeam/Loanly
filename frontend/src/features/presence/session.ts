// Keep the development username across reloads, independently for each tab.
const key = 'loanly.dev.username'

export function readDevSession(): string {
  try {
    const username = sessionStorage.getItem(key) ?? ''
    return /^[a-z0-9_]{3,20}$/.test(username) ? username : ''
  } catch {
    return ''
  }
}

export function saveDevSession(username: string): void {
  try { sessionStorage.setItem(key, username) } catch { /* Storage may be disabled. */ }
}

export function clearDevSession(): void {
  try { sessionStorage.removeItem(key) } catch { /* Storage may be disabled. */ }
}
