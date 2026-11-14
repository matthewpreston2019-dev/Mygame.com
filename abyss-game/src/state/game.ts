import { create } from 'zustand'
import { matchAnswer } from '../engine/matcher'
import { dailyQuestions, endlessQueue, pickQuestions } from '../engine/questionBank'
import { dateKey } from '../engine/rng'
import { SCORING } from '../engine/scoring'
import type { Category, GameMode, Question, RoundResult } from '../engine/types'
import { CATEGORIES } from '../engine/types'
import { play } from '../lib/audio'
import { useProfile, type RecordOutcome } from './profile'
import type { GameSummary } from './profileTypes'

/**
 * Game flow state machine:
 *   idle → intro → question → reveal → (intro → question → reveal)* → over
 * Every transition is guarded by the current phase so double submits, late
 * timer callbacks or rapid key presses can never corrupt a run.
 */
export type Phase = 'idle' | 'intro' | 'question' | 'reveal' | 'over'

interface GameState {
  mode: GameMode
  categories: Category[]
  questions: Question[]
  index: number
  phase: Phase
  results: RoundResult[]
  lives: number
  /** Epoch ms when the current question times out. */
  deadline: number
  questionStartedAt: number
  /** Remaining ms while paused, otherwise null. */
  paused: number | null
  dailyKey?: string
  summary: GameSummary | null
  outcome: RecordOutcome | null

  start: (mode: GameMode, categories?: Category[]) => boolean
  beginQuestion: () => void
  submit: (input: string, timedOut?: boolean) => void
  next: () => void
  pause: () => void
  resume: () => void
  abandon: () => void
  reset: () => void
}

const QUESTION_MS = SCORING.secondsPerQuestion * 1000

const initial = {
  mode: 'standard' as GameMode,
  categories: [...CATEGORIES] as Category[],
  questions: [] as Question[],
  index: 0,
  phase: 'idle' as Phase,
  results: [] as RoundResult[],
  lives: SCORING.endlessLives,
  deadline: 0,
  questionStartedAt: 0,
  paused: null as number | null,
  dailyKey: undefined as string | undefined,
  summary: null as GameSummary | null,
  outcome: null as RecordOutcome | null,
}

function longestStreak(results: RoundResult[]): number {
  let best = 0
  let cur = 0
  for (const r of results) {
    cur = r.answer ? cur + 1 : 0
    best = Math.max(best, cur)
  }
  return best
}

export const useGame = create<GameState>()((set, get) => ({
  ...initial,

  start(mode, categories = [...CATEGORIES]) {
    const profile = useProfile.getState()
    const avoid = new Set(profile.recentQuestionIds)
    let questions: Question[]
    let key: string | undefined
    if (mode === 'daily') {
      key = dateKey()
      if (profile.dailies[key]) return false // one attempt per day
      questions = dailyQuestions(key)
    } else if (mode === 'endless') {
      questions = endlessQueue(categories, avoid)
    } else {
      questions = pickQuestions({ categories, avoid })
    }
    if (!questions.length) return false
    set({
      ...initial,
      mode,
      categories,
      questions,
      dailyKey: key,
      phase: 'intro',
    })
    return true
  },

  beginQuestion() {
    if (get().phase !== 'intro') return
    const now = Date.now()
    set({ phase: 'question', deadline: now + QUESTION_MS, questionStartedAt: now, paused: null })
  },

  submit(input, timedOut = false) {
    const s = get()
    if (s.phase !== 'question' || s.paused !== null) return
    const q = s.questions[s.index]
    if (!q) return
    const trimmed = input.trim()
    const match = trimmed ? matchAnswer(q, trimmed) : { answer: null }
    const elapsed = Math.min(SCORING.secondsPerQuestion, (Date.now() - s.questionStartedAt) / 1000)
    const result: RoundResult = {
      questionId: q.id,
      category: q.category,
      input: trimmed,
      answer: match.answer,
      points: match.answer ? match.answer.points : 0,
      timedOut: timedOut && !match.answer,
      timeUsed: Math.round(elapsed * 10) / 10,
    }
    const lives = s.mode === 'endless' && !match.answer ? s.lives - 1 : s.lives
    set({ phase: 'reveal', results: [...s.results, result], lives })

    if (match.answer) {
      const tier = match.answer.tier
      play(tier === 'legendary' ? 'legendary' : tier === 'epic' || tier === 'rare' ? 'rare' : 'correct')
    } else {
      play(timedOut && !trimmed ? 'timeout' : 'wrong')
    }
  },

  next() {
    const s = get()
    if (s.phase !== 'reveal') return
    const isOver =
      s.mode === 'endless' ? s.lives <= 0 || s.index + 1 >= s.questions.length : s.index + 1 >= s.questions.length
    if (isOver) {
      finish(true)
      return
    }
    set({ index: s.index + 1, phase: 'intro' })
  },

  pause() {
    const s = get()
    if (s.phase !== 'question' || s.paused !== null) return
    set({ paused: Math.max(0, s.deadline - Date.now()) })
  },

  resume() {
    const s = get()
    if (s.paused === null) return
    const now = Date.now()
    // Shift the start time too so "time used" excludes the pause.
    const usedBefore = QUESTION_MS - s.paused
    set({ deadline: now + s.paused, questionStartedAt: now - usedBefore, paused: null })
  },

  abandon() {
    const s = get()
    // A daily attempt counts once a question has been seen, so it can't be re-rolled.
    if (s.mode === 'daily' && (s.results.length > 0 || s.phase === 'question')) {
      if (s.phase === 'question') {
        const q = s.questions[s.index]
        const forfeit: RoundResult = { questionId: q.id, category: q.category, input: '', answer: null, points: 0, timedOut: false, timeUsed: 0 }
        useGame.setState({ results: [...s.results, forfeit] })
      }
      finish(false)
      return
    }
    set({ ...initial })
  },

  reset() {
    set({ ...initial })
  },
}))

function finish(completed: boolean) {
  const s = useGame.getState()
  const results = s.results
  const correct = results.filter((r) => r.answer).length
  const score = results.reduce((a, r) => a + r.points, 0)
  const asked = s.questions.slice(0, results.length)
  const summary: GameSummary = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    mode: s.mode,
    dailyKey: s.dailyKey,
    score,
    correct,
    total: s.mode === 'endless' ? results.length : s.questions.length,
    results,
    questionTexts: Object.fromEntries(asked.map((q) => [q.id, q.text])),
    endedAt: Date.now(),
    completed,
    bestStreakInGame: longestStreak(results),
  }
  const profile = useProfile.getState()
  const outcome = profile.recordGame(summary)
  profile.markSeen(asked.map((q) => q.id))
  useGame.setState({ phase: 'over', summary, outcome })
  play('results')
  if (outcome.newAchievements.length) setTimeout(() => play('unlock'), 900)
}
