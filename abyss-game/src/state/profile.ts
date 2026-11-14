import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { GameMode } from '../engine/types'
import { ACHIEVEMENTS } from '../lib/achievements'
import type { ThemeId } from '../lib/cosmetics'
import { levelForXp, xpForGame } from '../lib/progression'
import { safeStorage } from '../lib/storage'
import type { GameSummary, ProfileData, Settings } from './profileTypes'

export const DIVER_NAMES = ['Nautilus', 'Coral', 'Marlin', 'Pearl', 'Tidewalker', 'Lumen', 'Kelp', 'Abalone', 'Drift', 'Riptide']

export function freshProfile(): ProfileData {
  return {
    name: `${DIVER_NAMES[Math.floor(Math.random() * DIVER_NAMES.length)]}${Math.floor(100 + Math.random() * 900)}`,
    createdAt: Date.now(),
    xp: 0,
    gamesPlayed: 0,
    totalAnswered: 0,
    totalCorrect: 0,
    totalPoints: 0,
    currentStreak: 0,
    bestStreak: 0,
    bests: { standard: 0, daily: 0, endless: 0 },
    bestAnswer: null,
    tierCounts: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
    categoryStats: {},
    history: [],
    dailies: {},
    achievements: {},
    recentQuestionIds: [],
    leaderboard: [],
    theme: 'abyssal',
    settings: { sound: true, volume: 0.6, reducedMotion: false, showTimerTicks: true },
    onboarded: false,
  }
}

export interface RecordOutcome {
  newAchievements: string[]
  xpGained: number
  levelBefore: number
  levelAfter: number
  personalBest: boolean
}

interface ProfileStore extends ProfileData {
  recordGame: (summary: GameSummary) => RecordOutcome
  markSeen: (ids: string[]) => void
  setName: (name: string) => void
  setTheme: (id: ThemeId) => void
  updateSettings: (patch: Partial<Settings>) => void
  setOnboarded: () => void
  importProfile: (data: ProfileData) => void
  resetProgress: () => void
}

export const useProfile = create<ProfileStore>()(
  persist(
    (set, get) => ({
      ...freshProfile(),

      recordGame(summary) {
        const p = get()
        const levelBefore = levelForXp(p.xp)
        const xpGained = xpForGame(summary.score, summary.correct, summary.completed)
        const prevBest = p.bests[summary.mode] ?? 0

        const next: ProfileData = structuredClone(stripActions(p))
        next.xp += xpGained
        next.gamesPlayed += 1
        next.totalAnswered += summary.results.length
        next.totalCorrect += summary.correct
        next.totalPoints += summary.score
        next.bests[summary.mode] = Math.max(prevBest, summary.score)

        for (const r of summary.results) {
          if (r.answer) {
            next.currentStreak += 1
            next.bestStreak = Math.max(next.bestStreak, next.currentStreak)
            next.tierCounts[r.answer.tier] += 1
            if (!next.bestAnswer || r.answer.share < next.bestAnswer.share) {
              next.bestAnswer = {
                text: r.answer.canonical,
                share: r.answer.share,
                tier: r.answer.tier,
                points: r.points,
                question: summary.questionTexts[r.questionId] ?? '',
                at: summary.endedAt,
              }
            }
          } else {
            next.currentStreak = 0
          }
          const cs = next.categoryStats[r.category] ?? { answered: 0, correct: 0, points: 0 }
          cs.answered += 1
          if (r.answer) cs.correct += 1
          cs.points += r.points
          next.categoryStats[r.category] = cs
        }

        next.history = [summary, ...next.history].slice(0, 40)
        if (summary.mode === 'daily' && summary.dailyKey) {
          next.dailies[summary.dailyKey] = {
            score: summary.score,
            correct: summary.correct,
            total: summary.total,
            tiers: summary.results.map((r) => r.answer?.tier ?? null),
          }
        }
        next.leaderboard = [
          ...next.leaderboard,
          {
            id: summary.id,
            name: next.name,
            mode: summary.mode,
            score: summary.score,
            correct: summary.correct,
            total: summary.total,
            dailyKey: summary.dailyKey,
            at: summary.endedAt,
          },
        ]
          .sort((a, b) => b.score - a.score)
          .slice(0, 100)

        const newAchievements: string[] = []
        for (const a of ACHIEVEMENTS) {
          if (!next.achievements[a.id] && a.check(next, summary)) {
            next.achievements[a.id] = Date.now()
            newAchievements.push(a.id)
          }
        }

        set(next)
        return {
          newAchievements,
          xpGained,
          levelBefore,
          levelAfter: levelForXp(next.xp),
          personalBest: summary.completed && summary.score > prevBest && summary.score > 0,
        }
      },

      markSeen(ids) {
        set((s) => ({ recentQuestionIds: [...ids, ...s.recentQuestionIds.filter((x) => !ids.includes(x))].slice(0, 120) }))
      },
      setName(name) {
        const clean = name.replace(/\s+/g, ' ').trim().slice(0, 20)
        if (clean) set({ name: clean })
      },
      setTheme(theme) {
        set({ theme })
      },
      updateSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }))
      },
      setOnboarded() {
        set({ onboarded: true })
      },
      importProfile(data) {
        set({ ...freshProfile(), ...data })
      },
      resetProgress() {
        const keepName = get().name
        set({ ...freshProfile(), name: keepName, onboarded: true })
      },
    }),
    {
      name: 'abyss-profile-v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      merge: (persisted, current) => {
        const base = freshProfile()
        const p = (persisted ?? {}) as Partial<ProfileData>
        return {
          ...current,
          ...base,
          ...p,
          bests: { ...base.bests, ...p.bests },
          tierCounts: { ...base.tierCounts, ...p.tierCounts },
          settings: { ...base.settings, ...p.settings },
        }
      },
    },
  ),
)

export function stripActions(s: ProfileStore | ProfileData): ProfileData {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { recordGame, markSeen, setName, setTheme, updateSettings, setOnboarded, importProfile, resetProgress, ...data } = s as ProfileStore
  return data
}

export const bestFor = (mode: GameMode) => useProfile.getState().bests[mode] ?? 0
