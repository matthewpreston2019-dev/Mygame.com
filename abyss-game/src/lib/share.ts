import { dailyNumber } from '../engine/rng'
import { depthForPoints, TIER_META } from '../engine/scoring'
import { zoneForDepth } from './progression'
import type { GameSummary } from '../state/profileTypes'

const MODE_LABEL = { standard: 'Dive', daily: 'Daily', endless: 'Endless' } as const

export function resultEmojis(summary: GameSummary): string {
  return summary.results.map((r) => (r.answer ? TIER_META[r.answer.tier].emoji : '⬛')).join('')
}

export function shareTitle(summary: GameSummary): string {
  if (summary.mode === 'daily' && summary.dailyKey) return `ABYSS Daily #${dailyNumber(summary.dailyKey)}`
  return `ABYSS ${MODE_LABEL[summary.mode]}`
}

export function buildShareText(summary: GameSummary): string {
  const rarest = summary.results
    .filter((r) => r.answer)
    .sort((a, b) => a.answer!.share - b.answer!.share)[0]
  const lines = [
    `🌊 ${shareTitle(summary)} — ${depthForPoints(summary.score).toLocaleString('en-US')} m deep · ${summary.score} pts`,
    resultEmojis(summary),
    `${summary.correct}/${summary.results.length} correct`,
  ]
  if (rarest?.answer) lines.push(`Rarest find: ${TIER_META[rarest.answer.tier].label}`)
  lines.push('The rarer the answer, the deeper the dive.')
  return lines.join('\n')
}

/** Render a 1080×1350 result card to a PNG blob. */
export async function renderShareCard(summary: GameSummary, accent: string, playerName: string): Promise<Blob | null> {
  const W = 1080
  const H = 1350
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Banded pixel ocean, darkening with depth.
  const bands: [number, string][] = [
    [0, '#1c70ac'],
    [0.18, '#0d4278'],
    [0.4, '#092654'],
    [0.62, '#051332'],
    [0.82, '#030a1e'],
  ]
  for (let y = 0; y < H; y += 12) {
    const f = y / H
    let c = bands[0][1]
    for (const [at, col] of bands) if (f >= at) c = col
    ctx.fillStyle = c
    ctx.fillRect(0, y, W, 12)
  }
  const rand = (() => {
    let s = summary.score + 7
    return () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  })()
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(200,240,255,${0.2 + rand() * 0.5})`
    const sz = rand() < 0.2 ? 12 : 6
    ctx.fillRect(Math.round((rand() * W) / 6) * 6, Math.round((rand() * H) / 6) * 6, sz, sz)
  }
  // Pixel frame
  ctx.fillStyle = '#3ee8e0'
  ctx.fillRect(36, 36, W - 72, 12)
  ctx.fillRect(36, H - 48, W - 72, 12)
  ctx.fillRect(36, 36, 12, H - 72)
  ctx.fillRect(W - 48, 36, 12, H - 72)

  const pixel = "'Press Start 2P', monospace"
  const body = "VT323, monospace"
  const depth = depthForPoints(summary.score)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#0b5f68'
  ctx.font = `64px ${pixel}`
  ctx.fillText('ABYSS', W / 2 + 8, 168)
  ctx.fillStyle = accent
  ctx.fillText('ABYSS', W / 2, 160)

  ctx.fillStyle = '#ff8fab'
  ctx.font = `30px ${pixel}`
  ctx.fillText(shareTitle(summary).replace('ABYSS ', '').toUpperCase(), W / 2, 240)

  ctx.fillStyle = '#8fb3cf'
  ctx.font = `26px ${pixel}`
  ctx.fillText('FINAL DEPTH', W / 2, 340)
  ctx.fillStyle = '#000'
  ctx.font = `92px ${pixel}`
  ctx.fillText(`${depth.toLocaleString('en-US')}M`, W / 2 + 8, 468)
  ctx.fillStyle = accent
  ctx.fillText(`${depth.toLocaleString('en-US')}M`, W / 2, 460)
  ctx.fillStyle = '#e8f6ff'
  ctx.font = `48px ${body}`
  ctx.fillText(`${zoneForDepth(depth).toUpperCase()} · ${summary.score} POINTS`, W / 2, 540)

  // tier tiles
  const n = summary.results.length
  const shown = Math.min(n, 14)
  const size = shown > 7 ? 58 : 96
  const gap = shown > 7 ? 12 : 20
  const perRow = Math.min(shown, 7)
  const rows = Math.ceil(shown / 7)
  const startY = 720
  for (let i = 0; i < shown; i++) {
    const row = Math.floor(i / 7)
    const col = i % 7
    const inRow = row === rows - 1 ? shown - row * 7 : perRow
    const rowW = inRow * size + (inRow - 1) * gap
    const x = (W - rowW) / 2 + col * (size + gap)
    const y = startY + row * (size + gap)
    const r = summary.results[i]
    ctx.fillStyle = r.answer ? TIER_META[r.answer.tier].color : 'rgba(255,255,255,0.08)'
    ctx.fillRect(x, y, size, size)
    if (!r.answer) {
      ctx.fillStyle = '#ff4f5e'
      ctx.font = `${Math.round(size * 0.5)}px ${pixel}`
      ctx.fillText('X', x + size / 2, y + size * 0.72)
    }
  }

  const infoY = startY + rows * (size + gap) + 110
  ctx.fillStyle = '#e2f6ff'
  ctx.font = `56px ${body}`
  ctx.fillText(`${summary.correct}/${n} correct`, W / 2, infoY)

  const rarest = summary.results.filter((r) => r.answer).sort((a, b) => a.answer!.share - b.answer!.share)[0]
  if (rarest?.answer) {
    ctx.fillStyle = TIER_META[rarest.answer.tier].color
    ctx.font = `52px ${body}`
    ctx.fillText(`Rarest find: “${rarest.answer.canonical}” · ${TIER_META[rarest.answer.tier].label}`, W / 2, infoY + 70, W - 120)
  }

  ctx.fillStyle = 'rgba(226,246,255,0.55)'
  ctx.font = `44px ${body}`
  ctx.fillText(`${playerName.toUpperCase()} · THE RARER, THE DEEPER`, W / 2, H - 90)

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}
