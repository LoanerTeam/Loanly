const key = 'loanly.auth.token'

export function readToken(): string {
  try { return sessionStorage.getItem(key) ?? '' } catch { return '' }
}

export function saveToken(token: string): void {
  try { sessionStorage.setItem(key, token) } catch { /* Continue in memory if storage is blocked. */ }
}

export function clearToken(): void {
  try { sessionStorage.removeItem(key) } catch { /* Storage may be disabled. */ }
}
