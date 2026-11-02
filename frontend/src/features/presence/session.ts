// Keep the development username across reloads, independently for each tab.
const key = 'loanly.dev.username'

export function readDevSession(): string {
  try {
    return (sessionStorage.getItem(key) ?? '').trim()
  } catch {
    return ''
  }
}

export function saveDevSession(username: string): void {
  try { sessionStorage.setItem(key, username.trim()) } catch { /* Storage may be disabled. */ }
}

export function clearDevSession(): void {
  try { sessionStorage.removeItem(key) } catch { /* Storage may be disabled. */ }
}
