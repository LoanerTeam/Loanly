import { useSyncExternalStore } from 'react'
import { getConnectionStatus, subscribeConnection } from '../../ws/client'
import { getPresence, subscribePresence } from './store'

export function usePresence() {
  const presence = useSyncExternalStore(subscribePresence, getPresence)
  const status = useSyncExternalStore(subscribeConnection, getConnectionStatus)
  return { ...presence, status }
}
