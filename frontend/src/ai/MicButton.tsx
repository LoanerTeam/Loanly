import { useEffect, useRef, useState } from 'react'
import { transcribeAudio } from './api'

const MAX_SECONDS = 120 // keeps recordings far below the server's upload limit
// In order of preference; the server accepts webm, ogg, wav and mp4 (Safari records mp4).
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

export function pickMimeType(isSupported: (type: string) => boolean): string {
  return MIME_TYPES.find(isSupported) ?? ''
}

type Phase = 'idle' | 'recording' | 'transcribing'

// Record -> upload -> put the transcript in the chat box. It never sends the message itself.
export function MicButton({ token, onText }: { token: string; onText: (text: string) => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(timer.current)
      // Releasing the stream turns the browser's recording indicator off.
      recorder.current?.stream.getTracks().forEach((track) => track.stop())
      if (recorder.current?.state === 'recording') recorder.current.stop()
    }
  }, [])

  async function start() {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('The microphone needs HTTPS or localhost, and a browser that can record audio.')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone access was blocked. Allow it in the browser and try again.')
      return
    }
    if (!alive.current) { stream.getTracks().forEach((track) => track.stop()); return }
    const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type))
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
    rec.onstop = async () => {
      clearTimeout(timer.current)
      stream.getTracks().forEach((track) => track.stop())
      recorder.current = null
      if (!alive.current) return
      if (!chunks.length) { setPhase('idle'); setError('Nothing was recorded. Try again.'); return }
      setPhase('transcribing')
      try {
        const { text } = await transcribeAudio(token, new Blob(chunks, { type: rec.mimeType || mimeType }))
        if (alive.current) onText(text)
      } catch (failure) {
        if (alive.current) setError(failure instanceof Error ? failure.message : 'Could not transcribe.')
      } finally {
        if (alive.current) setPhase('idle')
      }
    }
    recorder.current = rec
    rec.start()
    setPhase('recording')
    timer.current = setTimeout(() => rec.state === 'recording' && rec.stop(), MAX_SECONDS * 1000)
  }

  function toggle() {
    if (phase === 'recording') recorder.current?.stop()
    else if (phase === 'idle') void start()
  }

  const label = phase === 'recording' ? 'Stop recording' : phase === 'transcribing' ? 'Transcribing…' : 'Record a message'
  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={phase === 'transcribing'}
        aria-label={label}
        aria-pressed={phase === 'recording'}
        title={label}
        className={`rounded-lg border px-3 py-2 disabled:opacity-50 ${phase === 'recording' ? 'border-red-600 bg-red-50 text-red-700' : 'border-slate-300'}`}
      >
        {phase === 'recording' ? '■ Stop' : phase === 'transcribing' ? '…' : '🎤'}
      </button>
      {error && <p role="alert" className="absolute bottom-full left-0 mb-1 w-64 rounded bg-white p-2 text-xs text-red-600 shadow">{error}</p>}
    </div>
  )
}
