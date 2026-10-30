import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { MessageInput } from './MessageInput'
import { MessageItem } from './MessageItem'
import type { Message, Room } from './types'

export function ChatRoom({ room, messages, me, error, toolbar, messageLeading, messageActions, inputExtra, firstUnreadId = '', onSend }: {
  room: Room
  messages: Message[]
  me: string
  error?: string
  toolbar?: ReactNode // attach point for room-level AI tools (summarize unread)
  messageActions?: (message: Message) => ReactNode
  messageLeading?: (message: Message) => ReactNode
  inputExtra?: (insert: (text: string) => void) => ReactNode // attach point for the microphone
  firstUnreadId?: string // the divider goes above this message
  onSend: (text: string) => boolean
}) {
  const end = useRef<HTMLLIElement>(null)
  const divider = useRef<HTMLLIElement>(null)
  const atBottom = useRef(true) // measured on scroll, i.e. before a new message is rendered
  const shown = useRef({ roomId: '', count: 0, unreadId: '' })
  useEffect(() => {
    const previous = shown.current
    shown.current = { roomId: room.id, count: messages.length, unreadId: firstUnreadId }
    const opened = previous.roomId !== room.id || previous.count === 0 || previous.unreadId !== firstUnreadId
    // Open at the oldest Unread Message; afterwards follow new messages only for a reader at the bottom.
    if (opened && firstUnreadId) { divider.current?.scrollIntoView?.({ block: 'start' }); return }
    if (opened || atBottom.current || messages[messages.length - 1]?.sender === me) {
      end.current?.scrollIntoView?.({ block: 'end' })
    }
  }, [messages, me, room.id, firstUnreadId])
  return (
    <section className="flex h-[70vh] flex-col rounded-2xl border border-slate-200 bg-white" aria-label={`Chat with ${room.name}`}>
      <header className="border-b border-slate-200 px-4 py-3 font-semibold">{room.name}</header>
      {toolbar}
      <ul className="flex-1 space-y-3 overflow-y-auto p-4" aria-label="Messages" onScroll={(event) => {
        const box = event.currentTarget
        atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40
      }}>
        {messages.map((m) => (
          <Fragment key={m.id}>
            {m.id === firstUnreadId && (
              <li ref={divider} role="separator" aria-label="Unread messages" className="flex items-center gap-2 text-xs text-red-500">
                <span className="h-px flex-1 bg-red-300" /><span>Unread</span><span className="h-px flex-1 bg-red-300" />
              </li>
            )}
            <MessageItem message={m} me={me} leading={messageLeading?.(m)} actions={messageActions?.(m)} />
          </Fragment>
        ))}
        {!messages.length && <li className="text-center text-sm text-slate-500">No messages yet. Say hello.</li>}
        <li ref={end} aria-hidden="true" />
      </ul>
      {error && <p role="alert" className="px-4 pb-1 text-sm text-red-600">{error}</p>}
      <MessageInput onSend={onSend} renderExtra={inputExtra} />
    </section>
  )
}
