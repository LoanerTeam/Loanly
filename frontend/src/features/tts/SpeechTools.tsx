import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createSpeech } from './api'

// One owner per Chat Room: selecting another Message cancels the previous operation.
const SpeechContext = createContext<{ claim: (stop: () => void) => void }>({ claim: () => {} })
type Operation = { controller: AbortController; audio?: HTMLAudioElement; url?: string }

export function SpeechTools({ children }: { children: ReactNode }) {
  const active = useRef<(() => void) | null>(null)
  useEffect(() => () => { active.current?.(); active.current = null }, [])
  return <SpeechContext value={{ claim(stop) { active.current?.(); active.current = stop } }}>
    {children}
  </SpeechContext>
}

export function SpeakButton({ token, text, label = 'Read message aloud' }: {
  token: string; text: string; label?: string
}) {
  const { claim } = useContext(SpeechContext)
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [error, setError] = useState('')
  const current = useRef<Operation | null>(null)

  function stop() {
    const operation = current.current
    current.current = null
    operation?.controller.abort()
    if (operation?.audio) {
      operation.audio.onended = null
      operation.audio.onerror = null
      operation.audio.pause()
      operation.audio.removeAttribute('src')
      operation.audio.load()
    }
    if (operation?.url) URL.revokeObjectURL(operation.url)
  }
  useEffect(() => () => stop(), [token, text])

  async function speak() {
    if (current.current) { stop(); setState('idle'); return }
    claim(() => { stop(); setState('idle') })
    const operation: Operation = { controller: new AbortController() }
    current.current = operation
    setError(''); setState('loading')
    try {
      const blob = await createSpeech(token, text, operation.controller.signal)
      if (current.current !== operation) return
      if (!blob.size || blob.type.split(';')[0] !== 'audio/wav') throw new Error('Could not create speech. Please try again.')
      operation.url = URL.createObjectURL(blob)
      const audio = new Audio(operation.url)
      operation.audio = audio
      audio.onended = () => { if (current.current === operation) { stop(); setState('idle') } }
      audio.onerror = () => {
        if (current.current !== operation) return
        stop(); setState('idle'); setError('Could not play speech. Please try again.')
      }
      await audio.play()
      if (current.current === operation) setState('playing')
    } catch (failure) {
      if (current.current !== operation) return
      stop(); setState('idle')
      setError(failure instanceof DOMException && failure.name === 'NotAllowedError'
        ? 'Audio playback was blocked. Press the speaker to try again.'
        : failure instanceof Error ? failure.message : 'Could not play speech. Please try again.')
    }
  }

  const action = state === 'loading' ? 'Cancel speech' : state === 'playing' ? 'Stop speech' : error ? 'Retry speech' : label
  return <div className="relative inline-flex shrink-0 text-sm">
    <button type="button" className={`inline-flex size-8 items-center justify-center rounded-full hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${state !== 'idle' ? 'text-blue-600' : 'text-slate-500'}`}
      aria-label={action} title={action} aria-pressed={state !== 'idle'} onClick={() => void speak()}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        className={`size-4 ${state === 'loading' ? 'animate-pulse motion-reduce:animate-none' : ''}`}>
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
      </svg>
    </button>
    {state === 'loading' && <span role="status" className="sr-only">Creating speech…</span>}
    {error && <p role="alert" className="absolute left-0 top-full z-10 w-56 rounded-lg border border-red-200 bg-white p-2 text-red-600 shadow-sm">{error}</p>}
  </div>
}
