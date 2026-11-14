import { useEffect, useRef } from 'react'
import { TIER_META } from '../../engine/scoring'
import { play } from '../../lib/audio'
import { oceanBus } from './oceanBus'
import { ANGLER, bake, DIGITS, FISH, JELLY, PIP_FRAMES, PIP_PALETTE, SQUID, type SpriteSheet } from './sprites'

/**
 * The game world: a vertically scrolling pixel-art ocean rendered to a
 * low-resolution canvas and scaled up with nearest-neighbour filtering.
 *
 * World units are metres. The camera follows the player; `depth` is where the
 * player should be, and changes are animated as a physical descent.
 */

interface Props {
  depth: number
  reducedMotion: boolean
}

/** Screen pixels per metre of depth, independent of the pixel scale. */
const SCREEN_PX_PER_M = 1.6
const FLOOR_M = 10_650

type RGB = [number, number, number]
const WATER: [number, RGB][] = [
  [0, [44, 156, 206]],
  [150, [24, 112, 172]],
  [600, [13, 66, 122]],
  [1500, [9, 38, 84]],
  [4000, [5, 19, 50]],
  [7000, [3, 10, 30]],
  [10_500, [2, 4, 14]],
]

function waterAt(m: number): RGB {
  if (m <= WATER[0][0]) return WATER[0][1]
  for (let i = 1; i < WATER.length; i++) {
    const [d1, c1] = WATER[i]
    const [d0, c0] = WATER[i - 1]
    if (m <= d1) {
      const t = (m - d0) / (d1 - d0)
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t]
    }
  }
  return WATER[WATER.length - 1][1]
}
const rgb = (c: RGB, k = 1) => `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Rock wall thickness (screen px) at a depth — stepped for a pixel look. */
function wallAt(m: number, side: 0 | 1): number {
  const q = Math.floor(m / 6) * 6
  const p = side ? 2.1 : 0
  return 18 + 26 * (0.5 + 0.28 * Math.sin(q * 0.011 + p) + 0.14 * Math.sin(q * 0.037 + 1.3 + p) + 0.08 * Math.sin(q * 0.0061 + 4 + p))
}

type Species = 'fish' | 'jelly' | 'squid' | 'angler'
interface Creature {
  species: Species
  m: number
  x: number
  vx: number
  hue: number
  phase: number
}
interface Particle {
  x: number
  m: number
  v: number
  size: number
  life?: number
}
interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
}

function speciesFor(m: number): Species {
  const r = Math.random()
  if (m < 350) return 'fish'
  if (m < 1500) return r < 0.6 ? 'fish' : 'jelly'
  if (m < 4500) return r < 0.45 ? 'jelly' : r < 0.8 ? 'squid' : 'angler'
  return r < 0.4 ? 'jelly' : r < 0.6 ? 'squid' : 'angler'
}

const FISH_COLORS = ['#ffd23e', '#ff9a3e', '#5ad7ff', '#ff6f91', '#b8f05a']

export function PixelOcean({ depth, reducedMotion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const targetRef = useRef(depth)
  const reducedRef = useRef(reducedMotion)
  targetRef.current = depth
  reducedRef.current = reducedMotion

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const shade = document.createElement('canvas')
    const sctx = shade.getContext('2d')!

    // Sprite cache
    const pip = PIP_FRAMES.map((f) => bake(f, PIP_PALETTE))
    const fishSprites = FISH_COLORS.flatMap((c) => {
      const pal = { f: c, t: shadeHex(c, 0.7), k: '#10142a' }
      return [bake(FISH, pal), bake(FISH, pal, true)]
    })
    const silverFish = [bake(FISH, { f: '#9fc4d8', t: '#6b8ea4', k: '#10142a' }), bake(FISH, { f: '#9fc4d8', t: '#6b8ea4', k: '#10142a' }, true)]
    const jelly = [bake(JELLY, { j: '#c79bff', h: '#f3e6ff' }), bake(JELLY, { j: '#7cf5ff', h: '#e6feff' })]
    const squid = [bake(SQUID, { s: '#d9534f', k: '#ffef9a' })]
    const angler = [bake(ANGLER, { a: '#6a7ea0', b: '#2b3550', t: '#1f2740', w: '#ffef9a', k: '#000', z: '#e6e6e6', L: '#fff7b0' })]
    angler.push(bake(ANGLER, { a: '#6a7ea0', b: '#2b3550', t: '#1f2740', w: '#ffef9a', k: '#000', z: '#e6e6e6', L: '#fff7b0' }, true))
    const digits = Object.fromEntries(Object.entries(DIGITS).map(([k, g]) => [k, bake(g, { '#': '#d8f4ff' })])) as Record<string, SpriteSheet>
    const digitsPink = Object.fromEntries(Object.entries(DIGITS).map(([k, g]) => [k, bake(g, { '#': '#ff8fab' })])) as Record<string, SpriteSheet>

    let W = 0
    let H = 0
    let scale = 3
    let ppm = SCREEN_PX_PER_M / scale

    const resize = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      scale = Math.max(2, Math.min(4, Math.round(vw / 360)))
      W = Math.ceil(vw / scale)
      H = Math.ceil(vh / scale)
      ppm = SCREEN_PX_PER_M / scale
      canvas.width = W
      canvas.height = H
      canvas.style.width = `${W * scale}px`
      canvas.style.height = `${H * scale}px`
      shade.width = W
      shade.height = H
      ctx.imageSmoothingEnabled = false
    }
    resize()
    window.addEventListener('resize', resize)

    // Camera
    let cam = targetRef.current
    let tween: { from: number; to: number; start: number; dur: number } | null = null
    let lastTarget = cam
    let prevCam = cam

    // Entities
    const creatures: Creature[] = []
    const snow: Particle[] = []
    const bubbles: Particle[] = []
    const sparks: Spark[] = []
    let flash = 0
    let shake = 0
    let lastBurst = oceanBus.burstId

    const viewSpan = () => H / ppm
    const spawnCreature = (m: number, x?: number): Creature => {
      const species = speciesFor(m)
      const speed = species === 'fish' ? 10 + Math.random() * 14 : species === 'angler' ? 4 + Math.random() * 4 : 2 + Math.random() * 4
      const dir = Math.random() < 0.5 ? -1 : 1
      return { species, m, x: x ?? Math.random() * W, vx: speed * dir, hue: Math.floor(Math.random() * FISH_COLORS.length), phase: Math.random() * 10 }
    }
    const populate = () => {
      creatures.length = 0
      snow.length = 0
      const span = viewSpan()
      for (let i = 0; i < 9; i++) creatures.push(spawnCreature(cam - span * 0.5 + Math.random() * span * 1.2))
      for (let i = 0; i < 70; i++) snow.push({ x: Math.random() * W, m: cam - span / 2 + Math.random() * span * 1.2, v: 2 + Math.random() * 4, size: Math.random() < 0.15 ? 2 : 1 })
    }
    populate()

    let py = H * 0.3
    let px = W / 2
    let goalX = px
    let goalY = py
    let anchorCheck = 0
    let firstLocate = true
    const locateAnchor = () => {
      const el = document.getElementById('player-anchor')
      if (el) {
        const r = el.getBoundingClientRect()
        goalX = (r.left + r.width / 2) / scale
        goalY = (r.top + r.height / 2) / scale
      } else {
        goalX = W / 2
        goalY = H * 0.3
      }
      if (firstLocate) {
        px = goalX
        py = goalY
        firstLocate = false
      }
    }

    let raf = 0
    let last = performance.now()
    let tentacleClock = 0
    let bubbleClock = 0

    const frame = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000))
      last = now
      const t = now / 1000
      const reduced = reducedRef.current

      // Re-read the player anchor a few times a second (layout can change).
      anchorCheck -= dt
      if (anchorCheck <= 0) {
        locateAnchor()
        anchorCheck = 0.2
      }
      // Glide (rather than jump) when the layout moves the diver's slot.
      const ease = reduced ? 1 : Math.min(1, dt * 5)
      px += (goalX - px) * ease
      py += (goalY - py) * ease

      // ── Camera tween ────────────────────────────────────────────────
      const target = targetRef.current
      if (target !== lastTarget) {
        const delta = target - cam
        if (reduced || Math.abs(delta) > 6000) {
          cam = target
          tween = null
          populate()
        } else {
          const down = delta > 0
          const dur = down ? Math.min(2600, Math.max(900, 700 + delta * 1.2)) : Math.min(1600, 600 + Math.abs(delta) * 0.3)
          tween = { from: cam, to: target, start: now + (down ? 350 : 0), dur }
          if (down && delta >= 100) setTimeout(() => play('descend'), 350)
        }
        lastTarget = target
      }
      if (tween) {
        const k = Math.min(1, Math.max(0, (now - tween.start) / tween.dur))
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
        cam = tween.from + (tween.to - tween.from) * e
        if (k >= 1) tween = null
      }
      const camVel = (cam - prevCam) / Math.max(dt, 0.001) // m/s
      prevCam = cam
      const descending = camVel > 40
      oceanBus.depth = cam
      oceanBus.descending = descending

      // Bursts
      if (oceanBus.burstId !== lastBurst) {
        lastBurst = oceanBus.burstId
        const tier = oceanBus.burstTier
        if (tier) {
          const color = TIER_META[tier].color
          const big = tier === 'legendary' ? 2 : tier === 'epic' ? 1.4 : 1
          const n = reduced ? 10 : Math.round(26 * big)
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + Math.random() * 0.3
            const sp = (30 + Math.random() * 50) * big
            sparks.push({ x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.9 + Math.random() * 0.6, color: Math.random() < 0.3 ? '#ffffff' : color })
          }
          flash = tier === 'legendary' ? 0.8 : tier === 'epic' ? 0.55 : 0.35
          if (!reduced) shake = tier === 'legendary' ? 0.6 : tier === 'epic' ? 0.35 : 0
        }
      }

      const sx = shake > 0 ? Math.round((Math.random() - 0.5) * 4) : 0
      const sy = shake > 0 ? Math.round((Math.random() - 0.5) * 4) : 0
      shake = Math.max(0, shake - dt)
      ctx.save()
      ctx.translate(sx, sy)

      const yOf = (m: number) => py + (m - cam) * ppm
      const mOf = (y: number) => cam + (y - py) / ppm

      // ── Water / sky bands ───────────────────────────────────────────
      const band = 3
      for (let y = -band; y < H + band; y += band) {
        const m = mOf(y)
        if (m < 0) {
          const k = Math.max(0, Math.min(1, -m / 300))
          ctx.fillStyle = rgb([150 - 40 * k, 214 - 30 * k, 245 - 10 * k])
        } else if (m > FLOOR_M) {
          ctx.fillStyle = '#07060c'
        } else {
          ctx.fillStyle = rgb(waterAt(m))
        }
        ctx.fillRect(-4, y, W + 8, band)
      }

      // Surface wave + sun glints
      const surfaceY = yOf(0)
      if (surfaceY > -10 && surfaceY < H + 10) {
        ctx.fillStyle = '#ffffff'
        for (let x = 0; x < W; x += 2) {
          const wy = Math.round(surfaceY + Math.sin(x * 0.18 + t * 2.2) * 1.2)
          ctx.fillRect(x, wy, 2, 1)
          ctx.fillStyle = 'rgba(255,255,255,0.35)'
          ctx.fillRect(x, wy + 2, 2, 1)
          ctx.fillStyle = '#ffffff'
        }
        // Pixel clouds
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        for (let i = 0; i < 4; i++) {
          const cx = ((i * 97 + t * 3) % (W + 60)) - 30
          const cy = surfaceY - 40 - i * 13
          if (cy < -10) continue
          ctx.fillRect(cx, cy, 22, 4)
          ctx.fillRect(cx + 5, cy - 3, 12, 3)
        }
      }

      // Light rays near the surface
      const camTop = mOf(0)
      if (camTop < 500) {
        const alpha = 0.1 * Math.max(0, 1 - Math.max(0, camTop) / 500)
        ctx.fillStyle = `rgba(200,240,255,${alpha})`
        for (let i = 0; i < 6; i++) {
          const base = ((i * 61 + Math.sin(t * 0.4 + i) * 8) % (W + 40)) - 20
          const top = Math.max(0, surfaceY)
          for (let y = top; y < H; y += 3) {
            const off = (y - top) * 0.35
            ctx.fillRect(Math.round(base + off), y, 6 + (i % 3) * 3, 3)
          }
        }
      }

      // ── Marine snow (with speed streaks while descending) ──────────
      const span = viewSpan()
      const topM = mOf(-10)
      const botM = mOf(H + 10)
      const streak = Math.min(18, Math.max(0, camVel * ppm * 0.05))
      for (const p of snow) {
        if (!reduced) p.m += p.v * dt
        let y = yOf(p.m)
        if (y < -12) {
          p.m = botM + Math.random() * 40
          p.x = Math.random() * W
          y = yOf(p.m)
        } else if (y > H + 12) {
          p.m = topM - Math.random() * 40
          p.x = Math.random() * W
          y = yOf(p.m)
        }
        if (p.m < 0) continue
        ctx.fillStyle = 'rgba(210,235,255,0.35)'
        ctx.fillRect(Math.round(p.x), Math.round(y), p.size, p.size + Math.round(streak))
      }

      // ── Creatures ───────────────────────────────────────────────────
      const glows: { x: number; y: number; r: number; color: string }[] = []
      for (let i = 0; i < creatures.length; i++) {
        const c = creatures[i]
        if (!reduced) c.x += c.vx * dt
        if (c.x < -30) c.x = W + 20
        if (c.x > W + 30) c.x = -20
        let y = yOf(c.m)
        if (y < -30 || y > H + 30 || c.m < 15 || c.m > FLOOR_M - 30) {
          // Respawn ahead of the direction of travel (below when descending).
          const m = camVel < -40 ? topM - Math.random() * 60 : y < -30 || c.m < 15 ? botM + Math.random() * span * 0.3 : cam - span * 0.5 + Math.random() * span
          creatures[i] = spawnCreature(Math.max(30, Math.min(FLOOR_M - 40, m)))
          continue
        }
        const facingRight = c.vx > 0
        const bob = reduced ? 0 : Math.sin(t * 2 + c.phase)
        let sprite: SpriteSheet
        if (c.species === 'fish') {
          sprite = c.m > 700 ? silverFish[facingRight ? 0 : 1] : fishSprites[c.hue * 2 + (facingRight ? 0 : 1)]
          y += bob
        } else if (c.species === 'jelly') {
          sprite = jelly[c.hue % 2]
          y += Math.round(bob * 2)
          if (c.m > 900) glows.push({ x: c.x + 3, y: y + 3, r: 7, color: c.hue % 2 ? 'rgba(124,245,255,' : 'rgba(199,155,255,' })
        } else if (c.species === 'squid') {
          sprite = squid[0]
          y += Math.round(bob * 1.5)
        } else {
          sprite = angler[facingRight ? 0 : 1]
          const lureX = facingRight ? c.x + 10 : c.x + 1
          glows.push({ x: lureX, y: y + 2, r: 9, color: 'rgba(255,240,150,' })
        }
        ctx.drawImage(sprite.canvas, Math.round(c.x), Math.round(y))
      }

      // ── Rock walls with kelp, coral and tube worms ─────────────────
      const deco: { x: number; y: number; m: number; side: 0 | 1 }[] = []
      for (let y = 0; y < H; y += 2) {
        const m = mOf(y)
        if (m < -2) continue
        const water = waterAt(Math.max(0, m))
        const lw = Math.round(wallAt(m, 0) / scale)
        const rw = Math.round(wallAt(m, 1) / scale)
        ctx.fillStyle = rgb(water, 0.42)
        ctx.fillRect(-4, y, lw + 4, 2)
        ctx.fillRect(W - rw, y, rw + 4, 2)
        ctx.fillStyle = rgb(water, 0.7)
        ctx.fillRect(lw - 1, y, 1, 2)
        ctx.fillRect(W - rw, y, 1, 2)
      }
      // Deco anchors at fixed world depths so they scroll with the walls.
      const stepM = 45
      for (let am = Math.floor(topM / stepM) * stepM; am < botM; am += stepM) {
        if (am < 8 || am > FLOOR_M) continue
        for (const side of [0, 1] as const) {
          if (hash(am * 3.1 + side * 17) < 0.45) continue
          const w = Math.round(wallAt(am, side) / scale)
          deco.push({ x: side ? W - w : w, y: Math.round(yOf(am)), m: am, side })
        }
      }
      for (const d of deco) {
        const hgt = 10 + Math.floor(hash(d.m + d.side) * 16)
        if (d.m < 900) {
          // Kelp: sways from the wall edge.
          const col = d.m < 250 ? '#3fbf62' : d.m < 600 ? '#2e8f5a' : '#245f52'
          ctx.fillStyle = col
          for (let i = 0; i < hgt; i++) {
            const sway = reduced ? 0 : Math.round(Math.sin(t * 1.6 + d.m * 0.1 + i * 0.25) * (i / hgt) * 3)
            const x = d.side ? d.x - 1 - Math.round(i * 0.15) + sway : d.x + Math.round(i * 0.15) + sway
            ctx.fillRect(x, d.y - i, 2, 1)
            if (i % 4 === 2) ctx.fillRect(x + (d.side ? -2 : 2), d.y - i, 2, 1)
          }
          if (d.m < 220) {
            // Coral clumps in the sunlit shallows.
            ctx.fillStyle = hash(d.m) < 0.5 ? '#ff7a8a' : '#ffb347'
            const cx = d.side ? d.x - 4 : d.x
            ctx.fillRect(cx, d.y, 4, 2)
            ctx.fillRect(cx + 1, d.y - 2, 2, 2)
          }
        } else {
          // Bioluminescent tube worms in the dark.
          const glowCol = hash(d.m * 2) < 0.5 ? 'rgba(62,232,224,' : 'rgba(255,111,145,'
          const n = 2 + Math.floor(hash(d.m * 5) * 3)
          for (let k = 0; k < n; k++) {
            const x = d.side ? d.x - 2 - k * 2 : d.x + k * 2
            const h = 3 + Math.floor(hash(d.m + k) * 6)
            ctx.fillStyle = 'rgba(40,50,80,1)'
            ctx.fillRect(x, d.y - h, 1, h)
            glows.push({ x, y: d.y - h, r: 3, color: glowCol })
          }
        }
      }

      // Trench floor
      const floorY = yOf(FLOOR_M)
      if (floorY < H) {
        ctx.fillStyle = '#141020'
        for (let x = 0; x < W; x += 3) ctx.fillRect(x, Math.round(floorY - hash(x) * 4), 3, H)
      }

      // ── Bubbles ─────────────────────────────────────────────────────
      bubbleClock -= dt
      if (bubbleClock <= 0 && !reduced) {
        bubbleClock = descending ? 0.04 : 0.5 + Math.random() * 0.6
        bubbles.push({ x: px + (Math.random() - 0.5) * 8, m: mOf(py - 8), v: 12 + Math.random() * 10, size: Math.random() < 0.3 ? 3 : 2, life: 4 })
        if (Math.random() < 0.3) bubbles.push({ x: Math.random() * W, m: botM, v: 15 + Math.random() * 15, size: 2, life: 8 })
      }
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]
        b.m -= b.v * dt
        b.life! -= dt
        b.x += Math.sin(t * 3 + i) * 0.15
        const y = yOf(b.m)
        if (y < -6 || b.life! <= 0 || b.m < 0) {
          bubbles.splice(i, 1)
          continue
        }
      }

      // ── Darkness with the player's lantern ─────────────────────────
      const dark = Math.max(0, Math.min(0.82, (cam - 400) / 5200))
      if (dark > 0.01) {
        sctx.globalCompositeOperation = 'source-over'
        sctx.clearRect(0, 0, W, H)
        sctx.fillStyle = `rgba(0,2,10,${dark})`
        sctx.fillRect(0, 0, W, H)
        sctx.globalCompositeOperation = 'destination-out'
        const r = 30 + Math.sin(t * 2) * 1
        const steps = [
          [r, 0.35],
          [r * 0.72, 0.6],
          [r * 0.45, 1],
        ] as const
        for (const [rad, a] of steps) {
          sctx.fillStyle = `rgba(0,0,0,${a})`
          pixelCircle(sctx, px, py, rad)
        }
        for (const g of glows) {
          sctx.fillStyle = 'rgba(0,0,0,0.5)'
          pixelCircle(sctx, g.x, g.y, g.r)
        }
        ctx.drawImage(shade, 0, 0)
      }

      // Glows on top of the darkness
      for (const g of glows) {
        const pulse = 0.5 + 0.3 * Math.sin(t * 3 + g.x)
        ctx.fillStyle = `${g.color}${0.25 * pulse})`
        pixelCircle(ctx, g.x, g.y, g.r * 0.6)
        ctx.fillStyle = `${g.color}0.95)`
        ctx.fillRect(Math.round(g.x), Math.round(g.y), 1, 1)
      }

      for (const b of bubbles) {
        const y = Math.round(yOf(b.m))
        const x = Math.round(b.x)
        ctx.fillStyle = 'rgba(220,250,255,0.75)'
        if (b.size === 3) {
          ctx.fillRect(x + 1, y, 1, 1)
          ctx.fillRect(x, y + 1, 1, 1)
          ctx.fillRect(x + 2, y + 1, 1, 1)
          ctx.fillRect(x + 1, y + 2, 1, 1)
        } else ctx.fillRect(x, y, 2, 2)
      }

      // ── Depth ruler (left edge) ────────────────────────────────────
      const tick = 50
      for (let m = Math.floor(topM / tick) * tick; m < botM; m += tick) {
        if (m < 0 || m > FLOOR_M) continue
        const y = Math.round(yOf(m))
        const major = m % 100 === 0
        ctx.fillStyle = major ? 'rgba(216,244,255,0.85)' : 'rgba(216,244,255,0.45)'
        ctx.fillRect(0, y, major ? 6 : 3, 1)
        if (major) drawNumber(ctx, digits, `${m}m`, 8, y - 2)
      }
      // Player depth notch
      ctx.fillStyle = '#ff6f91'
      ctx.fillRect(0, Math.round(py), 8, 1)
      ctx.fillRect(0, Math.round(py) - 1, 2, 3)
      if (scale >= 3 || W > 220) drawNumber(ctx, digitsPink, `${Math.round(cam)}m`, 10, Math.round(py) + 3)

      // ── Player ──────────────────────────────────────────────────────
      tentacleClock += dt
      const frameIdx = descending ? 2 : Math.floor(tentacleClock / 0.35) % 2
      const sprite = pip[frameIdx]
      const bobY = reduced || descending ? 0 : Math.round(Math.sin(t * 2.4) * 2)
      const wobX = descending ? Math.round(Math.sin(t * 18) * 1) : 0
      const pScale = 2
      ctx.drawImage(sprite.canvas, Math.round(px - (sprite.w * pScale) / 2) + wobX, Math.round(py - (sprite.h * pScale) / 2) + bobY, sprite.w * pScale, sprite.h * pScale)
      if (descending && !reduced) {
        // Speed lines streaming past the diver.
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        for (let i = 0; i < 6; i++) {
          const lx = Math.round(px - 22 + hash(i + Math.floor(t * 12)) * 44)
          const ly = Math.round(py - 30 + ((t * 260 + i * 37) % 70))
          ctx.fillRect(lx, ly, 1, 8)
        }
      }

      // Sparks
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.vx *= 0.96
        s.vy = s.vy * 0.96 - 6 * dt
        s.life -= dt
        if (s.life <= 0) {
          sparks.splice(i, 1)
          continue
        }
        ctx.fillStyle = s.color
        const sz = s.life > 0.6 ? 2 : 1
        ctx.fillRect(Math.round(s.x), Math.round(s.y), sz, sz)
      }

      ctx.restore()
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash})`
        ctx.fillRect(0, 0, W, H)
        flash = Math.max(0, flash - dt * 2.2)
      }

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden" aria-hidden="true">
      <canvas ref={canvasRef} className="pixelated absolute left-0 top-0" />
    </div>
  )
}

function pixelCircle(c: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const rr = Math.round(r)
  for (let dy = -rr; dy <= rr; dy += 1) {
    const half = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)))
    c.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2, 1)
  }
}

function drawNumber(c: CanvasRenderingContext2D, font: Record<string, SpriteSheet>, text: string, x: number, y: number) {
  let cx = x
  for (const ch of text) {
    const g = font[ch]
    if (g) c.drawImage(g.canvas, cx, y)
    cx += 4
  }
}

function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * k)
  const g = Math.round(((n >> 8) & 255) * k)
  const b = Math.round((n & 255) * k)
  return `rgb(${r},${g},${b})`
}
