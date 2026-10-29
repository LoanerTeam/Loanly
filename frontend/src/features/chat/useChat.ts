import { useSyncExternalStore } from 'react'
import { getChat, subscribeChat } from './store'

export function useChat() {
  const state = useSyncExternalStore(subscribeChat, getChat)
  const active = state.rooms.find((r) => r.id === state.activeId) ?? null
  return { ...state, active, activeMessages: active ? state.messages[active.id] ?? [] : [] }
}
