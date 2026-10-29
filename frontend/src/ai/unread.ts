import type { CatchUp } from '../features/chat/store'
import type { Message } from '../features/chat/types'

export const MAX_SUMMARY = 200
export type SummaryLine = { sender: string; text: string }

// The Unread Messages are the last `count` messages from others up to the newest one seen
// when the room was opened; the server only ever needs the latest MAX_SUMMARY of them.
export function unreadForSummary(messages: Message[], me: string, catchUp: CatchUp | null, roomId: string): SummaryLine[] {
  if (!catchUp || catchUp.roomId !== roomId || catchUp.count <= 0) return []
  const end = messages.findIndex((m) => m.id === catchUp.lastId)
  if (end < 0) return []
  return messages.slice(0, end + 1).filter((m) => m.sender !== me)
    .slice(-Math.min(catchUp.count, MAX_SUMMARY))
    .map(({ sender, text }) => ({ sender, text }))
}
