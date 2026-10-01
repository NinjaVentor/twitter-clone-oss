import { format } from 'date-fns'

/** X-style relative timestamp: 5s, 3m, 2h, 4d, then MMM d. */
export function timeAgo(iso: string): string {
  const d = new Date(iso)
  const s = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d`
  if (d.getFullYear() === new Date().getFullYear()) return format(d, 'MMM d')
  return format(d, 'MMM d, yyyy')
}
