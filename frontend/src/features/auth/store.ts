import { disconnect, getConnectionStatus, subscribeConnection } from '../../ws/client'
import { resetChat } from '../chat/store'
import { resetGroups } from '../groups/store'
import { resetPresence } from '../presence/store'
import { authenticate, getMe, onUnauthorized, ApiError, type AuthMode, type Profile } from './api'
import { clearToken, readToken, saveToken } from './session'

export type AuthState = {
  status: 'checking' | 'anonymous' | 'authenticated' | 'error'
  token: string; user: Profile | null; busy: boolean; error: string
}

export function createAuthStore() {
  let state: AuthState = { status: 'checking', token: '', user: null, busy: false, error: '' }
  let generation = 0
  let activeToken = ''
  const listeners = new Set<() => void>()
  const publish = (next: AuthState) => { state = next; listeners.forEach((fn) => fn()) }

  const logout = (error = '') => {
    generation += 1
    activeToken = ''
    clearToken()
    publish({ status: 'anonymous', token: '', user: null, busy: false, error })
    disconnect()
    resetPresence(); resetGroups(); resetChat()
  }

  async function verify(token: string, current: number) {
    try {
      const user = await getMe(token)
      if (current !== generation) return
      publish({ status: 'authenticated', token, user, busy: false, error: '' })
    } catch (error) {
      if (current !== generation) return
      if (error instanceof ApiError && error.status === 401) { logout('Please sign in again.'); return }
      publish({ status: 'error', token: '', user: null, busy: false,
        error: error instanceof Error ? error.message : 'Could not verify your account. Try again.' })
    }
  }

  const restore = async () => {
    const current = ++generation
    const token = readToken()
    activeToken = token
    if (!token) {
      publish({ status: 'anonymous', token: '', user: null, busy: false, error: '' })
      return
    }
    publish({ status: 'checking', token: '', user: null, busy: false, error: '' })
    await verify(token, current)
  }

  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    restore,
    logout,
    async submit(mode: AuthMode, username: string, password: string) {
      if (state.busy) return
      const current = ++generation
      activeToken = ''
      publish({ status: 'anonymous', token: '', user: null, busy: true, error: '' })
      try {
        const { token } = await authenticate(mode, username, password)
        if (current !== generation) return
        activeToken = token
        saveToken(token)
        publish({ status: 'checking', token: '', user: null, busy: false, error: '' })
        await verify(token, current)
      } catch (error) {
        if (current !== generation) return
        publish({ status: 'anonymous', token: '', user: null, busy: false,
          error: error instanceof Error ? error.message : 'Could not sign in. Try again.' })
      }
    },
    start() {
      const offApi = onUnauthorized((token) => {
        if (token === activeToken) logout('Please sign in again.')
      })
      const offSocket = subscribeConnection(() => {
        if (getConnectionStatus() === 'unauthorized' && state.status === 'authenticated') {
          logout('Please sign in again.')
        }
      })
      void restore()
      return () => { generation += 1; offApi(); offSocket() }
    },
  }
}
