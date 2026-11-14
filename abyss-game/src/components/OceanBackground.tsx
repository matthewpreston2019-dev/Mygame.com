import { useEffect, useRef } from 'react'

interface Props {
  /** 0 = surface, 1 = hadal depths. Smoothly darkens the scene. */
  depth: number
  reducedMotion: boolean
}

interface Particle {
  x: number
  y: number
  r: number
  vy: number
  vx: number
  a: number
  phase: number
  kind: 'snow' | 'bubble' | 'glow'
}

/**
 * Layered underwater scene: CSS gradients + light rays, and a single canvas
 * for marine snow, rising bubbles and bioluminescent motes. The canvas pauses
 * when the tab is hidden and scales particle count to screen size.
 */
export function OceanBackground({ depth, reducedMotion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const depthRef = useRef(depth)
  depthRef.current = depth

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let dpr = 1
    let particles: Particle[] = []
    let raf = 0
    let last = performance.now()
    let glow = '34,211,238'
    let glowReadAt = -Infinity

    const make = (kind: Particle['kind'], anywhere = true): Particle => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : kind === 'bubble' ? h + 10 : -10,
      r: kind === 'bubble' ? 1.5 + Math.random() * 3.5 : kind === 'glow' ? 1 + Math.random() * 2.2 : 0.4 + Math.random() * 1.6,
      vy: kind === 'bubble' ? -(18 + Math.random() * 30) : kind === 'glow' ? (Math.random() - 0.5) * 6 : 4 + Math.random() * 10,
      vx: (Math.random() - 0.5) * 6,
      a: 0.2 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2,
      kind,
    })

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const area = (w * h) / (1280 * 800)
      const snow = Math.round(90 * Math.min(1.6, Math.max(0.45, area)))
      particles = [
        ...Array.from({ length: snow }, () => make('snow')),
        ...Array.from({ length: Math.round(snow * 0.18) }, () => make('bubble')),
        ...Array.from({ length: Math.round(snow * 0.22) }, () => make('glow')),
      ]
    }

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const d = depthRef.current
      if (now - glowReadAt > 1000) {
        glow = getComputedStyle(document.documentElement).getPropertyValue('--glow').trim().replace(/\s+/g, ',') || glow
        glowReadAt = now
      }
      ctx.clearRect(0, 0, w, h)
      for (const p of particles) {
        if (!reducedMotion) {
          p.phase += dt
          p.y += p.vy * dt
          p.x += (p.vx + Math.sin(p.phase * 0.7) * 6) * dt
          if (p.kind === 'bubble' && p.y < -12) Object.assign(p, make('bubble', false))
          if (p.kind !== 'bubble' && p.y > h + 12) Object.assign(p, make(p.kind, false))
          if (p.kind === 'glow' && (p.y < -12 || p.y > h + 12)) Object.assign(p, make('glow'))
          if (p.x < -12) p.x = w + 10
          if (p.x > w + 12) p.x = -10
        }
        if (p.kind === 'snow') {
          ctx.fillStyle = `rgba(200,235,255,${p.a * (0.55 - d * 0.2)})`
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          ctx.fill()
        } else if (p.kind === 'bubble') {
          const alpha = p.a * (0.5 - d * 0.35)
          if (alpha <= 0.02) continue
          ctx.strokeStyle = `rgba(210,245,255,${alpha})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          ctx.stroke()
          ctx.fillStyle = `rgba(255,255,255,${alpha * 0.8})`
          ctx.beginPath()
          ctx.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.25, 0, Math.PI * 2)
          ctx.fill()
        } else {
          // bioluminescent motes become more visible the deeper you go
          const twinkle = 0.5 + 0.5 * Math.sin(p.phase * 2.2)
          const alpha = (0.15 + d * 0.75) * twinkle * p.a
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6)
          g.addColorStop(0, `rgba(${glow},${alpha})`)
          g.addColorStop(1, `rgba(${glow},0)`)
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      if (!reducedMotion) raf = requestAnimationFrame(draw)
    }

    const onVisibility = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden) {
        last = performance.now()
        raf = requestAnimationFrame(draw)
      }
    }

    resize()
    raf = requestAnimationFrame(draw)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reducedMotion])

  const d = Math.max(0, Math.min(1, depth))

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* base gradient: surface blues fading to midnight */}
      <div
        className="absolute inset-0 transition-[background] duration-[2000ms]"
        style={{
          background: `radial-gradient(120% 80% at 50% -10%, rgba(30,120,170,${0.55 - d * 0.45}) 0%, rgba(8,40,80,${0.5 - d * 0.3}) 35%, transparent 70%),
            linear-gradient(180deg, hsl(208 ${70 - d * 30}% ${16 - d * 11}%) 0%, hsl(218 ${75 - d * 20}% ${8 - d * 5}%) 55%, #01040b 100%)`,
        }}
      />
      {/* light rays from the surface */}
      <div className="absolute inset-x-0 top-0 h-[85vh] transition-opacity duration-[2000ms]" style={{ opacity: Math.max(0, 0.9 - d * 1.1) }}>
        {[8, 22, 37, 55, 70, 86].map((left, i) => (
          <div
            key={left}
            className="absolute top-[-10%] h-[110%] origin-top"
            style={{
              left: `${left}%`,
              width: `${60 + (i % 3) * 40}px`,
              background: 'linear-gradient(180deg, rgba(180,240,255,0.16), rgba(180,240,255,0.04) 60%, transparent)',
              filter: 'blur(14px)',
              animation: reducedMotion ? undefined : `ray-sway ${9 + i * 1.7}s ease-in-out ${i * -2}s infinite`,
            }}
          />
        ))}
      </div>
      {/* distant silhouettes */}
      {!reducedMotion && (
        <>
          <svg className="absolute top-[22%] w-40 opacity-[0.07]" style={{ animation: 'drift 70s linear infinite' }} viewBox="0 0 200 60" fill="#bfefff">
            <path d="M10 30c30-22 90-26 140-8 12 4 22 2 34-8-3 10-3 22 0 32-12-10-22-12-34-8-50 18-110 14-140-8z" />
          </svg>
          <svg className="absolute top-[58%] w-24 opacity-[0.06]" style={{ animation: 'drift 52s linear -20s infinite' }} viewBox="0 0 200 60" fill="#bfefff">
            <path d="M10 30c30-22 90-26 140-8 12 4 22 2 34-8-3 10-3 22 0 32-12-10-22-12-34-8-50 18-110 14-140-8z" />
          </svg>
        </>
      )}
      <canvas ref={canvasRef} className="absolute inset-0" />
      {/* vignette */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)' }} />
    </div>
  )
}
