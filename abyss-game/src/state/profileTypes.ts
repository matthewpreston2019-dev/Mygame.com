import type { Category, GameMode, RarityTier, RoundResult } from '../engine/types'
import type { ThemeId } from '../lib/cosmetics'

export interface GameSummary {
  id: string
  mode: GameMode
  dailyKey?: string
  score: number
  correct: number
  total: number
  results: RoundResult[]
  /** Question text by id, so history stays readable if packs change. */
  questionTexts: Record<string, string>
  endedAt: number
  completed: boolean
  bestStreakInGame: number
}

export interface LocalLeaderboardEntry {
  id: string
  name: string
  mode: GameMode
  score: number
  correct: number
  total: number
  dailyKey?: string
  at: number
}

export interface BestAnswer {
  text: string
  share: number
  tier: RarityTier
  points: number
  question: string
  at: number
}

export interface Settings {
  sound: boolean
  volume: number
  reducedMotion: boolean
  showTimerTicks: boolean
}

export interface ProfileData {
  name: string
  createdAt: number
  xp: number
  gamesPlayed: number
  totalAnswered: number
  totalCorrect: number
  totalPoints: number
  currentStreak: number
  bestStreak: number
  bests: Record<GameMode, number>
  bestAnswer: BestAnswer | null
  tierCounts: Record<RarityTier, number>
  categoryStats: Partial<Record<Category, { answered: number; correct: number; points: number }>>
  history: GameSummary[]
  dailies: Record<string, { score: number; correct: number; total: number; tiers: (RarityTier | null)[] }>
  achievements: Record<string, number>
  recentQuestionIds: string[]
  leaderboard: LocalLeaderboardEntry[]
  theme: ThemeId
  settings: Settings
  onboarded: boolean
}
