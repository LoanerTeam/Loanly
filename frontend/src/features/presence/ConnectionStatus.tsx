import type { ConnectionStatus as Status } from '../../ws/client'

const labels: Record<Status, string> = {
  disconnected: 'Disconnected', connecting: 'Connecting…', connected: 'Connected',
  reconnecting: 'Reconnecting… User status may be out of date.', unauthorized: 'Please sign in again.',
}
export function ConnectionStatus({ status }: { status: Status }) {
  return <p role="status" className="text-sm text-slate-500">{labels[status]}</p>
}
