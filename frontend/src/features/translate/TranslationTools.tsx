import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { apiRequest, type Profile } from '../auth/api'

const languages = {
  en: 'English', th: 'ไทย', ja: '日本語', zh: '中文',
  ko: '한국어', es: 'Español', fr: 'Français', de: 'Deutsch',
}
const TranslationContext = createContext({ token: '', targetLang: 'en' })

export function TranslationTools({ token, initialLanguage, children }: {
  token: string; initialLanguage: string; children: ReactNode
}) {
  const [targetLang, setTargetLang] = useState(initialLanguage)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [error, setError] = useState('')
  async function save(language: string) {
    if (saving.current) return
    saving.current = true
    setBusy(true); setError('')
    try {
      const profile = await apiRequest<Profile>('/me', {
        method: 'PUT', token, body: { targetLang: language },
      })
      setTargetLang(profile.targetLang)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save your language. Try again.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return <TranslationContext value={{ token, targetLang }}>
    <div className="mb-4 text-sm">
      <label>Translation language{' '}
        <select className="rounded border border-slate-300 p-2" value={targetLang}
          disabled={busy} onChange={(event) => void save(event.target.value)}>
          {Object.entries(languages).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      {busy && <span role="status" className="ml-2">Saving…</span>}
      {error && <p role="alert" className="text-red-600">{error}</p>}
    </div>
    {children}
  </TranslationContext>
}

export function TranslateMessage({ text }: { text: string }) {
  const { token, targetLang } = useContext(TranslationContext)
  return <Translation key={`${token}:${targetLang}:${text}`} token={token} targetLang={targetLang} text={text} />
}

function Translation({ token, targetLang, text }: { token: string; targetLang: string; text: string }) {
  const [translation, setTranslation] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState('')
  async function translate() {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError('')
    try {
      const result = await apiRequest<{ translation: string }>('/ai/translate', {
        method: 'POST', token, body: { text, targetLang },
      })
      setTranslation(result.translation)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not translate. Try again.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return <div className="max-w-full text-sm">
    <button className="underline disabled:opacity-50" disabled={busy} onClick={() => void translate()}>
      {busy ? 'Translating…' : error ? 'Retry translation' : 'Translate'}
    </button>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {translation && <p role="status" lang={targetLang} className="mt-1 whitespace-pre-wrap break-words text-slate-700">{translation}</p>}
  </div>
}
