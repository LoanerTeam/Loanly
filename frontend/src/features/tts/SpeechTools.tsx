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

export function SpeakButton({ token, text }: { token: string; text: string }) {
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
        ? 'Audio playback was blocked. Press Retry speech to try again.'
        : failure instanceof Error ? failure.message : 'Could not play speech. Please try again.')
    }
  }

  return <div className="text-sm">
    <button className="underline" aria-label={state === 'loading' ? 'Cancel speech' : state === 'playing' ? 'Stop speech' : error ? 'Retry speech' : 'Read message aloud'}
      aria-pressed={state !== 'idle'} onClick={() => void speak()}>
      <span aria-hidden="true">{state === 'idle' ? '🔊' : '■'}</span>{' '}
      {state === 'loading' ? 'Creating speech…' : state === 'playing' ? 'Stop' : error ? 'Retry speech' : 'Speak'}
    </button>
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </div>
}
