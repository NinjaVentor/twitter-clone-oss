interface Props {
  weightedLength: number
}

const LIMIT = 280
const R = 10
const CIRC = 2 * Math.PI * R

/** Exact Twitter circular character-count ring. */
export default function ProgressRing({ weightedLength }: Props) {
  const remaining = LIMIT - weightedLength
  if (remaining > 20) {
    const progress = Math.min(weightedLength / LIMIT, 1)
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r={R} fill="none" stroke="#2f3336" strokeWidth="2" />
        <circle
          cx="10"
          cy="10"
          r={R}
          fill="none"
          stroke="#1d9bf0"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={CIRC.toFixed(2)}
          strokeDashoffset={(CIRC * (1 - progress)).toFixed(2)}
          transform="rotate(-90 10 10)"
        />
      </svg>
    )
  }
  const over = remaining < 0
  const color = over ? '#f4212e' : remaining <= 20 ? '#ffd400' : '#1d9bf0'
  const text = over ? String(remaining) : String(remaining)
  return (
    <span className="flex items-center gap-1.5">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <circle cx="13" cy="13" r={R} fill="none" stroke="#2f3336" strokeWidth="2" />
        <circle
          cx="13"
          cy="13"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={CIRC.toFixed(2)}
          strokeDashoffset={over ? '0' : (CIRC * (remaining / 20)).toFixed(2)}
          transform="rotate(-90 13 13)"
        />
      </svg>
      <span className="text-[13px]" style={{ color }}>
        {text}
      </span>
    </span>
  )
}
