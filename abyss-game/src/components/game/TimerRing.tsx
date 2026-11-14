interface Props {
  remainingMs: number
  totalMs: number
  paused?: boolean
}

export function TimerRing({ remainingMs, totalMs, paused }: Props) {
  const size = 76
  const stroke = 5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, remainingMs / totalMs))
  const secs = Math.ceil(remainingMs / 1000)
  const color = secs <= 5 ? '#f43f5e' : secs <= 10 ? '#fbbf24' : 'var(--accent)'
  return (
    <div
      className={`relative shrink-0 ${secs <= 5 && !paused ? 'animate-pulse' : ''}`}
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`${secs} seconds remaining`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.1)" strokeWidth={stroke} fill="rgba(2,8,20,0.4)" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke 0.4s' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-2xl font-semibold tabular-nums" style={{ color: secs <= 5 ? '#fda4af' : undefined }}>
        {secs}
      </span>
    </div>
  )
}
