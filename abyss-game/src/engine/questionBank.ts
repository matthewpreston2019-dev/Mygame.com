import { ALL_QUESTION_DEFS } from '../data'
import { compileQuestion } from './compile'
import { dateKey, hashString, mulberry32, shuffle } from './rng'
import { SCORING } from './scoring'
import type { Category, Difficulty, Question } from './types'
import { CATEGORIES } from './types'

export const QUESTIONS: Question[] = ALL_QUESTION_DEFS.map(compileQuestion)
const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]))

export const getQuestion = (id: string) => BY_ID.get(id)

export const CATEGORY_META: Record<Category, { label: string; icon: string; hue: number }> = {
  geography: { label: 'Geography', icon: '🌍', hue: 190 },
  animals: { label: 'Animals', icon: '🐙', hue: 160 },
  sports: { label: 'Sports', icon: '🏅', hue: 30 },
  science: { label: 'Science', icon: '🧪', hue: 260 },
  history: { label: 'History', icon: '🏛️', hue: 40 },
  entertainment: { label: 'Entertainment', icon: '🎬', hue: 330 },
  gaming: { label: 'Gaming', icon: '🎮', hue: 280 },
  food: { label: 'Food & Drink', icon: '🍜', hue: 15 },
  misc: { label: 'Miscellany', icon: '🧭', hue: 210 },
}

export function countByCategory(): Record<Category, number> {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
  for (const q of QUESTIONS) out[q.category]++
  return out
}

/** Difficulty curve for a 7-question run: warm up, then dive deeper. */
const CURVE: Difficulty[] = ['easy', 'easy', 'medium', 'medium', 'medium', 'hard', 'hard']

interface PickOptions {
  categories?: Category[]
  count?: number
  rand?: () => number
  /** Question ids to avoid if possible (recently played). */
  avoid?: Set<string>
}

/**
 * Pick a run of questions following the difficulty curve, spreading
 * categories as evenly as possible and preferring unseen questions.
 */
export function pickQuestions({
  categories = [...CATEGORIES],
  count = SCORING.questionsPerRun,
  rand = Math.random,
  avoid = new Set(),
}: PickOptions = {}): Question[] {
  const pool = QUESTIONS.filter((q) => categories.includes(q.category))
  const fresh = pool.filter((q) => !avoid.has(q.id))
  const source = fresh.length >= count * 2 ? fresh : pool
  const shuffled = shuffle(source, rand)
  const chosen: Question[] = []
  const usedCats = new Map<Category, number>()

  for (let i = 0; i < count; i++) {
    const want = CURVE[Math.min(i, CURVE.length - 1)]
    const minCatUse = Math.min(...categories.map((c) => usedCats.get(c) ?? 0))
    const candidates = shuffled.filter((q) => !chosen.includes(q))
    const scored = candidates.map((q) => {
      let score = 0
      if (q.difficulty === want) score += 2
      if ((usedCats.get(q.category) ?? 0) === minCatUse) score += 3
      return { q, score }
    })
    const best = Math.max(...scored.map((s) => s.score))
    const pick = scored.find((s) => s.score === best)?.q
    if (!pick) break
    chosen.push(pick)
    usedCats.set(pick.category, (usedCats.get(pick.category) ?? 0) + 1)
  }
  // Present in difficulty order for a satisfying descent.
  const order: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 }
  return chosen.sort((a, b) => order[a.difficulty] - order[b.difficulty])
}

/** The daily set: identical for every player on the same calendar date. */
export function dailyQuestions(key = dateKey()): Question[] {
  return pickQuestions({ rand: mulberry32(hashString(`abyss-daily-${key}`)) })
}

/** Endless mode: a long shuffled queue that gets harder as it goes. */
export function endlessQueue(categories: Category[] = [...CATEGORIES], avoid = new Set<string>()): Question[] {
  const pool = shuffle(
    QUESTIONS.filter((q) => categories.includes(q.category)),
    Math.random,
  )
  const fresh = pool.filter((q) => !avoid.has(q.id))
  const stale = pool.filter((q) => avoid.has(q.id))
  const by = (d: Difficulty) => [...fresh, ...stale].filter((q) => q.difficulty === d)
  // Interleave so difficulty ramps up over the first ~20 questions.
  const easy = by('easy')
  const medium = by('medium')
  const hard = by('hard')
  const queue: Question[] = []
  const take = (arr: Question[]) => arr.shift()
  const pattern = ['easy', 'easy', 'medium', 'easy', 'medium', 'medium', 'hard', 'medium', 'hard', 'hard'] as Difficulty[]
  let i = 0
  while (easy.length || medium.length || hard.length) {
    const want = i < pattern.length ? pattern[i] : (['medium', 'hard', 'hard'] as Difficulty[])[i % 3]
    const q = take(want === 'easy' ? easy : want === 'medium' ? medium : hard) ?? take(hard) ?? take(medium) ?? take(easy)
    if (q) queue.push(q)
    i++
  }
  return queue
}
