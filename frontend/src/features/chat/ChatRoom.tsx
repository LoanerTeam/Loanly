import { useEffect, useRef, type ReactNode } from 'react'
import { MessageInput } from './MessageInput'
import { MessageItem } from './MessageItem'
import type { Message, Room } from './types'

export function ChatRoom({ room, messages, me, error, toolbar, messageActions, onSend }: {
  room: Room
  messages: Message[]
  me: string
  error?: string
  toolbar?: ReactNode // attach point for room-level AI tools (summarize unread)
  messageActions?: (message: Message) => ReactNode
  onSend: (text: string) => boolean
}) {
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [messages.length, room.id])
  return (
    <section className="flex h-[70vh] flex-col rounded-2xl border border-slate-200 bg-white" aria-label={`Chat with ${room.name}`}>
      <header className="border-b border-slate-200 px-4 py-3 font-semibold">{room.name}</header>
      {toolbar}
      <ul className="flex-1 space-y-3 overflow-y-auto p-4" aria-label="Messages">
        {messages.map((m) => <MessageItem key={m.id} message={m} me={me} actions={messageActions?.(m)} />)}
        {!messages.length && <li className="text-center text-sm text-slate-500">No messages yet. Say hello.</li>}
        <li ref={end} aria-hidden="true" />
      </ul>
      {error && <p role="alert" className="px-4 pb-1 text-sm text-red-600">{error}</p>}
      <MessageInput onSend={onSend} />
    </section>
  )
}
