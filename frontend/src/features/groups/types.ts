export type Group = {
  id: string
  kind: 'group'
  name: string
  members: string[]
  creator: string
}

export function isGroup(value: unknown): value is Group {
  if (!value || typeof value !== 'object') return false
  const group = value as Record<string, unknown>
  return typeof group.id === 'string' && group.kind === 'group' &&
    typeof group.name === 'string' && typeof group.creator === 'string' &&
    Array.isArray(group.members) && group.members.every((member) => typeof member === 'string')
}
