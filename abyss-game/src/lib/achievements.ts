import type { GameSummary, ProfileData } from '../state/profileTypes'
import { CATEGORIES } from '../engine/types'

export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  check: (p: ProfileData, last: GameSummary) => boolean
}

const answeredTiers = (g: GameSummary) => g.results.map((r) => r.answer?.tier).filter(Boolean)

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-dive', name: 'First Dive', description: 'Finish your first game.', icon: '🤿', check: (p) => p.gamesPlayed >= 1 },
  { id: 'rare-find', name: 'Rare Find', description: 'Give a Rare (or rarer) answer.', icon: '🐚', check: (_, g) => answeredTiers(g).some((t) => t === 'rare' || t === 'epic' || t === 'legendary') },
  { id: 'epic-find', name: 'Deep Cut', description: 'Give an Epic answer.', icon: '🦑', check: (_, g) => answeredTiers(g).some((t) => t === 'epic' || t === 'legendary') },
  { id: 'legendary', name: 'Leviathan Sighting', description: 'Give a Legendary answer. Unlocks the Anglerfish Gold theme.', icon: '🐋', check: (_, g) => answeredTiers(g).includes('legendary') },
  { id: 'perfect', name: 'Perfect Descent', description: 'Answer all 7 questions correctly in a standard or daily run.', icon: '💎', check: (_, g) => g.mode !== 'endless' && g.total === 7 && g.correct === 7 },
  { id: 'score-400', name: 'Pressure Rising', description: 'Score 400+ points in one standard or daily run.', icon: '🌊', check: (_, g) => g.mode !== 'endless' && g.score >= 400 },
  { id: 'score-550', name: 'Crush Depth', description: 'Score 550+ points in one standard or daily run.', icon: '⚓', check: (_, g) => g.mode !== 'endless' && g.score >= 550 },
  { id: 'streak-10', name: 'Current Rider', description: 'Get 10 correct answers in a row.', icon: '🔥', check: (p) => p.bestStreak >= 10 },
  { id: 'daily-first', name: 'Daily Diver', description: 'Complete a daily challenge.', icon: '📅', check: (_, g) => g.mode === 'daily' },
  { id: 'daily-3', name: 'Tidal Rhythm', description: 'Complete the daily challenge 3 days in a row. Unlocks Bioluminescence.', icon: '🌙', check: (p) => dailyStreak(p.dailies) >= 3 },
  { id: 'endless-15', name: 'Bottomless', description: 'Answer 15 questions correctly in one endless dive.', icon: '♾️', check: (_, g) => g.mode === 'endless' && g.correct >= 15 },
  { id: 'polymath', name: 'Polymath', description: 'Answer correctly in every category.', icon: '🧠', check: (p) => CATEGORIES.every((c) => (p.categoryStats[c]?.correct ?? 0) > 0) },
  { id: 'quick', name: 'Reflexes', description: 'Answer correctly within 3 seconds.', icon: '⚡', check: (_, g) => g.results.some((r) => r.answer && r.timeUsed <= 3) },
  { id: 'veteran', name: 'Veteran Diver', description: 'Play 25 games.', icon: '🎖️', check: (p) => p.gamesPlayed >= 25 },
  { id: 'centurion', name: 'Centurion', description: 'Give 100 correct answers in total.', icon: '🏆', check: (p) => p.totalCorrect >= 100 },
]

/** Consecutive days (ending today or yesterday) with a completed daily. */
export function dailyStreak(dailies: Record<string, unknown>, today = new Date()): number {
  const has = (d: Date) => {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return k in dailies
  }
  const d = new Date(today)
  if (!has(d)) d.setDate(d.getDate() - 1)
  let streak = 0
  while (has(d)) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}
