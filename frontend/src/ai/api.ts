import { apiRequest } from '../features/auth/api'
import type { SummaryLine } from './unread'

export function transcribeAudio(token: string, audio: Blob) {
  const body = new FormData()
  body.append('audio', audio, 'recording')
  return apiRequest<{ text: string }>('/ai/stt', { method: 'POST', token, body })
}

export function summarizeUnread(token: string, roomName: string, messages: SummaryLine[]) {
  return apiRequest<{ summary: string }>('/ai/summarize', {
    method: 'POST', token, body: { roomName: roomName.slice(0, 200), messages },
  })
}
