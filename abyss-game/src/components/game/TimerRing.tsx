interface Props {
  remainingMs: number
  totalMs: number
  paused?: boolean
}

/** Segmented arcade timer: one lit segment per remaining second. */
export function TimerRing({ remainingMs, totalMs, paused }: Props) {
  const size = 60
  const segments = Math.round(totalMs / 1000)
  const secs = Math.ceil(remainingMs / 1000)
  const color = secs <= 5 ? '#ff4f5e' : secs <= 10 ? '#ffd23e' : '#3ee8e0'
  const cx = size / 2
  const r = size / 2 - 5
  return (
    <div
      className={`relative shrink-0 ${secs <= 5 && !paused ? 'blink' : ''}`}
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`${secs} seconds remaining`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
        <rect x="6" y="6" width={size - 12} height={size - 12} fill="#030814" />
        {Array.from({ length: segments }, (_, i) => {
          const a = (i / segments) * Math.PI * 2 - Math.PI / 2
          const x = Math.round(cx + Math.cos(a) * r) - 2
          const y = Math.round(cx + Math.sin(a) * r) - 2
          const lit = i < secs
          return <rect key={i} x={x} y={y} width="5" height="5" fill={lit ? color : '#16284a'} />
        })}
      </svg>
      <span className="font-display absolute inset-0 flex items-center justify-center text-sm" style={{ color }}>
        {secs}
      </span>
    </div>
  )
}
