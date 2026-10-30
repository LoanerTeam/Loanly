import { apiRequest } from '../auth/api'

export function createSpeech(token: string, text: string, signal: AbortSignal) {
  return apiRequest<Blob>('/ai/tts', {
    method: 'POST', token, body: { text }, signal, responseType: 'blob',
  })
}
