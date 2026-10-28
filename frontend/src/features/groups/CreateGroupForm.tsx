import { type FormEvent } from 'react'
import { createGroup, setGroupDraft } from './store'
import { useGroups } from './useGroups'

export function CreateGroupForm() {
  const { draft, pending, connected, error, notice } = useGroups()
  function submit(event: FormEvent) { event.preventDefault(); createGroup() }
  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <label className="block text-sm font-medium" htmlFor="group-name">Group name</label>
      <input id="group-name" value={draft} onChange={(event) => setGroupDraft(event.target.value)}
        disabled={!!pending} required className="w-full rounded-lg border border-slate-300 p-2" />
      <button type="submit" disabled={!connected || !!pending || !draft.trim()}
        className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">
        {pending ? 'Creating…' : 'Create Group'}
      </button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
    </form>
  )
}
