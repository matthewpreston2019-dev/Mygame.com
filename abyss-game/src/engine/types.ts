export const CATEGORIES = [
  'geography',
  'animals',
  'sports',
  'science',
  'history',
  'entertainment',
  'gaming',
  'food',
  'misc',
] as const

export type Category = (typeof CATEGORIES)[number]

export type Difficulty = 'easy' | 'medium' | 'hard'

export type RarityTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

/**
 * Authoring format for a question. Answers are listed from MOST to LEAST
 * commonly given. Each answer string may contain aliases separated by "|",
 * e.g. "United States|USA|US|America". The first entry is the canonical
 * display name.
 */
export interface QuestionDef {
  id: string
  category: Category
  text: string
  difficulty: Difficulty
  answers: string[]
  fact?: string
  /** Zipf exponent override: higher = popularity concentrated on top answers. */
  zipf?: number
  /** Filler words ignored when matching, e.g. ["sea"] so "Red Sea" matches "Red". */
  strip?: string[]
}

/** Compiled answer with rarity information. */
export interface Answer {
  canonical: string
  aliases: string[]
  /** Normalized keys (canonical + aliases) used for matching. */
  keys: string[]
  rank: number
  /** Estimated share of players giving this answer (0..1). */
  share: number
  points: number
  tier: RarityTier
}

export interface Question {
  id: string
  category: Category
  text: string
  difficulty: Difficulty
  answers: Answer[]
  fact?: string
  strip: string[]
}

export interface MatchResult {
  answer: Answer | null
  /** 'exact' (incl. alias), 'fuzzy' (typo tolerance) or 'none'. */
  kind: 'exact' | 'fuzzy' | 'none'
}

export type GameMode = 'standard' | 'daily' | 'endless'

export interface RoundResult {
  questionId: string
  category: Category
  input: string
  answer: Answer | null
  points: number
  timedOut: boolean
  /** Seconds taken to answer. */
  timeUsed: number
}
