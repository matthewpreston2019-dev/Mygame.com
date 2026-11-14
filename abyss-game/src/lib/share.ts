import { dailyNumber } from '../engine/rng'
import { TIER_META } from '../engine/scoring'
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
    `🌊 ${shareTitle(summary)} — ${summary.score} pts`,
    resultEmojis(summary),
    `${summary.correct}/${summary.results.length} correct`,
  ]
  if (rarest?.answer) lines.push(`Rarest find: ${TIER_META[rarest.answer.tier].label}`)
  lines.push('Dive deeper. Answer rarer.')
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

  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0b2a4a')
  bg.addColorStop(0.45, '#061a33')
  bg.addColorStop(1, '#01060f')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // light rays
  ctx.save()
  ctx.globalAlpha = 0.05
  ctx.filter = 'blur(24px)'
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = '#bff6ff'
    ctx.beginPath()
    const x = 120 + i * 170
    ctx.moveTo(x, 0)
    ctx.lineTo(x + 90, 0)
    ctx.lineTo(x - 140 + i * 30, H * 0.75)
    ctx.lineTo(x - 260 + i * 30, H * 0.75)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()

  // particles
  const rand = (() => {
    let s = summary.score + 7
    return () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  })()
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = `rgba(190,240,255,${0.15 + rand() * 0.45})`
    ctx.beginPath()
    ctx.arc(rand() * W, rand() * H, rand() * 2.6 + 0.4, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.textAlign = 'center'
  ctx.fillStyle = accent
  ctx.font = '600 40px Sora, system-ui, sans-serif'
  ctx.fillText('A B Y S S', W / 2, 150)

  ctx.fillStyle = '#e2f6ff'
  ctx.font = 'italic 600 64px Fraunces, Georgia, serif'
  ctx.fillText(shareTitle(summary).replace('ABYSS ', ''), W / 2, 250)

  ctx.shadowColor = accent
  ctx.shadowBlur = 60
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 260px Sora, system-ui, sans-serif'
  ctx.fillText(String(summary.score), W / 2, 560)
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(226,246,255,0.7)'
  ctx.font = '500 42px Sora, system-ui, sans-serif'
  ctx.fillText('points', W / 2, 630)

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
    roundRect(ctx, x, y, size, size, 18)
    ctx.fill()
    if (!r.answer) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 3
      ctx.stroke()
    }
  }

  const infoY = startY + rows * (size + gap) + 110
  ctx.fillStyle = '#e2f6ff'
  ctx.font = '600 46px Sora, system-ui, sans-serif'
  ctx.fillText(`${summary.correct}/${n} correct`, W / 2, infoY)

  const rarest = summary.results.filter((r) => r.answer).sort((a, b) => a.answer!.share - b.answer!.share)[0]
  if (rarest?.answer) {
    ctx.fillStyle = TIER_META[rarest.answer.tier].color
    ctx.font = '500 40px Sora, system-ui, sans-serif'
    ctx.fillText(`Rarest find: “${rarest.answer.canonical}” · ${TIER_META[rarest.answer.tier].label}`, W / 2, infoY + 70, W - 120)
  }

  ctx.fillStyle = 'rgba(226,246,255,0.55)'
  ctx.font = '400 34px Sora, system-ui, sans-serif'
  ctx.fillText(`${playerName} · Dive deeper. Answer rarer.`, W / 2, H - 80)

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
