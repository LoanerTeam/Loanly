import { useSyncExternalStore } from 'react'
import { getConnectionStatus, subscribeConnection } from '../../ws/client'
import { getGroups, subscribeGroups } from './store'

export function useGroups() {
  const state = useSyncExternalStore(subscribeGroups, getGroups)
  const status = useSyncExternalStore(subscribeConnection, getConnectionStatus)
  return { ...state, connected: status === 'connected' && state.ready }
}
