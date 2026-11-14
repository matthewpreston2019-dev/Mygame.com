import type { RarityTier } from './types'

/**
 * ─── RARITY SCORING ─────────────────────────────────────────────────────────
 *
 * 1. Popularity. Answers for each question are authored in order from most to
 *    least commonly given. Each answer's estimated share of players follows a
 *    Zipf distribution over that rank:
 *
 *        weight(rank) = 1 / rank^zipf          share = weight / Σ weights
 *
 * 2. Points. Points grow with the logarithm of how rare the answer is, so
 *    halving an answer's popularity always adds the same number of points:
 *
 *        rarity = clamp( log(1/share) / log(1/legendaryShare), 0, 1 )
 *        points = round( minPoints + (maxPoints − minPoints) × rarity )
 *
 *    An answer given by `legendaryShare` (0.5%) of players or fewer scores the
 *    full `maxPoints`. The most obvious answer still earns at least `minPoints`.
 *
 * 3. Incorrect or empty answers always score 0.
 *
 * Every constant below is configurable in one place.
 */
export const SCORING = {
  minPoints: 10,
  maxPoints: 100,
  legendaryShare: 0.005,
  defaultZipf: 1.15,
  /** Tier thresholds by estimated share (inclusive lower bound). */
  tiers: [
    { tier: 'common', minShare: 0.15 },
    { tier: 'uncommon', minShare: 0.06 },
    { tier: 'rare', minShare: 0.025 },
    { tier: 'epic', minShare: 0.01 },
    { tier: 'legendary', minShare: 0 },
  ] as { tier: RarityTier; minShare: number }[],
  questionsPerRun: 7,
  secondsPerQuestion: 25,
  endlessLives: 3,
}

export function zipfShares(count: number, zipf = SCORING.defaultZipf): number[] {
  const weights = Array.from({ length: count }, (_, i) => 1 / Math.pow(i + 1, zipf))
  const total = weights.reduce((a, b) => a + b, 0)
  return weights.map((w) => w / total)
}

export function pointsForShare(share: number): number {
  const { minPoints, maxPoints, legendaryShare } = SCORING
  if (share <= 0) return maxPoints
  const rarity = Math.log(1 / share) / Math.log(1 / legendaryShare)
  const clamped = Math.min(1, Math.max(0, rarity))
  return Math.round(minPoints + (maxPoints - minPoints) * clamped)
}

export function tierForShare(share: number): RarityTier {
  for (const t of SCORING.tiers) if (share >= t.minShare) return t.tier
  return 'legendary'
}

export const TIER_META: Record<RarityTier, { label: string; color: string; emoji: string; order: number }> = {
  common: { label: 'Common', color: '#94a3b8', emoji: '🟦', order: 0 },
  uncommon: { label: 'Uncommon', color: '#34d399', emoji: '🟩', order: 1 },
  rare: { label: 'Rare', color: '#38bdf8', emoji: '🟪', order: 2 },
  epic: { label: 'Epic', color: '#c084fc', emoji: '🟧', order: 3 },
  legendary: { label: 'Legendary', color: '#fbbf24', emoji: '🟨', order: 4 },
}

export function formatShare(share: number): string {
  const pct = share * 100
  if (pct >= 10) return `${Math.round(pct)}%`
  if (pct >= 1) return `${pct.toFixed(1)}%`
  if (pct >= 0.1) return `${pct.toFixed(2)}%`
  return '<0.1%'
}
