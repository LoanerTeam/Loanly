import type { ReactNode } from 'react'
import type { Message } from './types'

// `leading` sits before the bubble; `actions` sits below the Message timestamp.
export function MessageItem({ message, me, leading, actions }: {
  message: Message; me: string; leading?: ReactNode; actions?: ReactNode
}) {
  const mine = message.sender === me
  return (
    <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div className="flex max-w-[75%] items-center gap-1.5">
        {leading}
        <div className={`min-w-0 rounded-2xl px-4 py-2 ${mine ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-800'}`}>
          {!mine && <p className="text-xs font-medium text-slate-500">{message.sender}</p>}
          {/* React escapes text, so message content is never interpreted as HTML. */}
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
        </div>
      </div>
      <div className={`mt-1 flex max-w-[75%] flex-col gap-1 text-xs text-slate-500 ${mine ? 'items-end' : 'items-start'}`}>
        <time dateTime={message.ts}>{new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        {actions}
      </div>
    </li>
  )
}
