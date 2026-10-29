import { useId } from 'react'

export function PasswordField({ label, value, onChange, visible, onToggle, disabled, autoComplete,
  invalid, describedBy }: {
  label: string; value: string; onChange: (value: string) => void
  visible: boolean; onToggle: () => void; disabled: boolean
  autoComplete: 'current-password' | 'new-password'; invalid?: boolean; describedBy?: string
}) {
  const id = useId()
  return <div>
    <label className="block" htmlFor={id}>{label}</label>
    <div className="relative mt-2">
      <input id={id} className="w-full rounded-lg border border-slate-300 p-2 pr-12"
        type={visible ? 'text' : 'password'} value={value}
        onChange={(event) => onChange(event.target.value)} minLength={8} required disabled={disabled}
        autoComplete={autoComplete} aria-invalid={invalid || undefined} aria-describedby={describedBy} />
      <button type="button" className="absolute inset-y-0 right-0 rounded-lg px-3 text-slate-500 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800 disabled:opacity-50"
        aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-controls={id}
        aria-pressed={visible} onClick={onToggle} disabled={disabled}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
  </div>
}
