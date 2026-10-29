import { useState } from 'react'
import type { CatchUp } from '../features/chat/store'
import type { Message, Room } from '../features/chat/types'
import { summarizeUnread } from './api'
import { unreadForSummary } from './unread'

// Shown above a room's messages when it had Unread Messages on opening; the summary is not stored.
export function RoomAiBar({ room, messages, me, catchUp, token }: {
  room: Room
  messages: Message[]
  me: string
  catchUp: CatchUp | null
  token: string
}) {
  const [result, setResult] = useState({ busy: false, summary: '', error: '' })
  const unread = unreadForSummary(messages, me, catchUp, room.id)
  if (!unread.length || !catchUp) return null
  const label = catchUp.count > unread.length ? `latest ${unread.length} of ${catchUp.count}` : `${unread.length}`
  async function summarize() {
    setResult({ busy: true, summary: '', error: '' })
    try {
      const { summary } = await summarizeUnread(token, room.name, unread)
      setResult({ busy: false, summary, error: '' })
    } catch (error) {
      setResult({ busy: false, summary: '', error: error instanceof Error ? error.message : 'Could not summarize.' })
    }
  }
  return (
    <div className="border-b border-slate-200 px-4 py-2 text-sm">
      <button type="button" className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-50"
        disabled={result.busy} onClick={summarize}>
        {result.busy ? 'Summarizing…' : `Summarize ${label} unread`}
      </button>
      {result.summary && <p role="status" className="mt-2 whitespace-pre-wrap rounded-lg bg-amber-50 p-3 text-slate-700">{result.summary}</p>}
      {result.error && <p role="alert" className="mt-2 text-red-600">{result.error}</p>}
    </div>
  )
}
