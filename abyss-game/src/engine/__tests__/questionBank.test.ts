import { describe, expect, it } from 'vitest'
import { COUNTRIES } from '../../data/datasets/countries'
import { ELEMENTS } from '../../data/datasets/elements'
import { US_STATES } from '../../data/datasets/usStates'
import { matchAnswer } from '../matcher'
import { countByCategory, dailyQuestions, endlessQueue, pickQuestions, QUESTIONS } from '../questionBank'
import { CATEGORIES } from '../types'

describe('question database', () => {
  it('has hundreds of questions across every category', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(250)
    const counts = countByCategory()
    for (const c of CATEGORIES) expect(counts[c], c).toBeGreaterThanOrEqual(15)
  })
  it('datasets are complete', () => {
    expect(ELEMENTS).toHaveLength(118)
    expect(new Set(ELEMENTS.map((e) => e.symbol)).size).toBe(118)
    expect(US_STATES).toHaveLength(50)
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(195)
    const gen1 = QUESTIONS.find((q) => q.id === 'gam-gen1')!
    expect(gen1.answers).toHaveLength(151)
    expect(COUNTRIES.filter((c) => c.eu)).toHaveLength(27)
  })
  it('every question is well-formed', () => {
    const ids = new Set<string>()
    for (const q of QUESTIONS) {
      expect(ids.has(q.id), `duplicate id ${q.id}`).toBe(false)
      ids.add(q.id)
      expect(q.text.length).toBeGreaterThan(8)
      expect(q.answers.length, q.id).toBeGreaterThanOrEqual(3)
      for (const a of q.answers) expect(a.keys.length, `${q.id}: ${a.canonical}`).toBeGreaterThan(0)
    }
  })
  it('no two answers in a question share a match key', () => {
    const problems: string[] = []
    for (const q of QUESTIONS) {
      const seen = new Map<string, string>()
      for (const a of q.answers)
        for (const k of a.keys) {
          if (seen.has(k) && seen.get(k) !== a.canonical) problems.push(`${q.id}: "${k}" (${seen.get(k)} / ${a.canonical})`)
          seen.set(k, a.canonical)
        }
    }
    expect(problems).toEqual([])
  })
  it('every canonical answer and alias matches itself', () => {
    const failures: string[] = []
    for (const q of QUESTIONS)
      for (const a of q.answers)
        for (const name of [a.canonical, ...a.aliases]) {
          const m = matchAnswer(q, name)
          if (m.answer !== a) failures.push(`${q.id}: ${name} → ${m.answer?.canonical ?? 'none'}`)
        }
    expect(failures).toEqual([])
  })
})

describe('selection', () => {
  it('picks 7 distinct questions with varied categories', () => {
    const run = pickQuestions()
    expect(run).toHaveLength(7)
    expect(new Set(run.map((q) => q.id)).size).toBe(7)
    expect(new Set(run.map((q) => q.category)).size).toBeGreaterThanOrEqual(5)
  })
  it('respects category filters', () => {
    const run = pickQuestions({ categories: ['animals'] })
    expect(run.every((q) => q.category === 'animals')).toBe(true)
  })
  it('daily set is deterministic per date', () => {
    expect(dailyQuestions('2026-11-14').map((q) => q.id)).toEqual(dailyQuestions('2026-11-14').map((q) => q.id))
    expect(dailyQuestions('2026-11-14').map((q) => q.id)).not.toEqual(dailyQuestions('2026-11-15').map((q) => q.id))
  })
  it('endless queue covers the pool', () => {
    expect(endlessQueue().length).toBe(QUESTIONS.length)
  })
})
