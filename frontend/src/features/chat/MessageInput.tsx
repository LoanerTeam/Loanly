import { useState, type FormEvent, type ReactNode } from 'react'
import { MAX_TEXT } from './types'

// `extra` is the attach point for the microphone button (speech-to-text).
export function MessageInput({ onSend, extra }: { onSend: (text: string) => boolean; extra?: ReactNode }) {
  const [text, setText] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (onSend(text)) setText('')
  }
  return (
    <form className="flex items-center gap-2 border-t border-slate-200 p-3" onSubmit={submit}>
      {extra}
      <input
        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
        aria-label="Message"
        placeholder="Type a message"
        value={text}
        maxLength={MAX_TEXT}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
      />
      <button className="rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-40" type="submit" disabled={!text.trim()}>
        Send
      </button>
    </form>
  )
}
