export type Profile = { username: string; targetLang: string }
export type AuthMode = 'login' | 'register'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

const unauthorized = new Set<(token: string) => void>()
export function onUnauthorized(listener: (token: string) => void): () => void {
  unauthorized.add(listener)
  return () => { unauthorized.delete(listener) }
}

export async function apiRequest<T>(path: string, options: {
  method?: string; token?: string; body?: unknown
} = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      cache: 'no-store',
    })
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach Loanly. Check your connection and try again.')
  }
  if (!response.ok) {
    if (response.status === 401 && options.token) {
      const token = options.token
      unauthorized.forEach((listener) => listener(token))
    }
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, body?.error ?? 'request_failed',
      typeof body?.detail === 'string' ? body.detail : 'Something went wrong. Please try again.')
  }
  return response.json()
}

export function authenticate(mode: AuthMode, username: string, password: string) {
  return apiRequest<{ token: string }>(`/auth/${mode}`, { method: 'POST', body: { username, password } })
}

export function getMe(token: string) { return apiRequest<Profile>('/me', { token }) }
