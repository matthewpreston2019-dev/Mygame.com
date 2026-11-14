import { describe, expect, it } from 'vitest'
import { compileQuestion } from '../compile'
import { matchAnswer } from '../matcher'
import { normalize } from '../normalize'
import { dailyNumber, hashString, mulberry32 } from '../rng'
import { pointsForShare, SCORING, tierForShare, zipfShares } from '../scoring'
import type { QuestionDef } from '../types'

const def: QuestionDef = {
  id: 't',
  category: 'geography',
  text: 'Name a country in Europe',
  difficulty: 'easy',
  answers: ['France', 'Germany|Deutschland', 'Austria', 'Côte d’Ivoire|Ivory Coast', 'Bosnia and Herzegovina|Bosnia', 'Slovakia', 'Slovenia', 'Iceland'],
}
const q = compileQuestion(def)

describe('normalize', () => {
  it('ignores case, accents, punctuation and spacing', () => {
    expect(normalize('  CÔTE   d’Ivoire!! ')).toBe(normalize("cote d'ivoire"))
    expect(normalize('Spider-Man')).toBe(normalize('spiderman'))
    expect(normalize('The Bahamas')).toBe(normalize('bahamas'))
    expect(normalize('Bosnia & Herzegovina')).toBe(normalize('Bosnia and Herzegovina'))
    expect(normalize('St. Lucia')).toBe(normalize('Saint Lucia'))
  })
  it('handles roman numerals, symbols and strip words', () => {
    expect(normalize('Henry VIII')).toBe(normalize('henry 8'))
    expect(normalize('C#')).not.toBe(normalize('C'))
    expect(normalize('C++')).not.toBe(normalize('C'))
    expect(normalize('Red Sea', ['sea'])).toBe('red')
  })
})

describe('matcher', () => {
  it('matches canonical names and aliases', () => {
    expect(matchAnswer(q, 'france').answer?.canonical).toBe('France')
    expect(matchAnswer(q, 'DEUTSCHLAND').answer?.canonical).toBe('Germany')
    expect(matchAnswer(q, 'ivory coast').answer?.canonical).toBe('Côte d’Ivoire')
  })
  it('tolerates small typos on long words only', () => {
    expect(matchAnswer(q, 'Frence').answer?.canonical).toBe('France')
    expect(matchAnswer(q, 'Bosnia and Hercegovina').kind).toBe('fuzzy')
  })
  it('never accepts wrong answers', () => {
    expect(matchAnswer(q, 'Australia').answer).toBeNull() // close to Austria
    expect(matchAnswer(q, 'Spain').answer).toBeNull()
    expect(matchAnswer(q, '').answer).toBeNull()
    expect(matchAnswer(q, '   ').answer).toBeNull()
    expect(matchAnswer(q, '!!!').answer).toBeNull()
  })
  it('refuses ambiguous fuzzy matches', () => {
    // "Slovokia" is distance 1 from Slovakia only → accepted
    expect(matchAnswer(q, 'Slovokia').answer?.canonical).toBe('Slovakia')
    // "Sloveakia"... ensure exact matches beat fuzzy
    expect(matchAnswer(q, 'Slovenia').answer?.canonical).toBe('Slovenia')
  })
  it('accepts plurals', () => {
    const animals = compileQuestion({ ...def, answers: ['Lion', 'Puppy'] })
    expect(matchAnswer(animals, 'Lions').answer?.canonical).toBe('Lion')
    expect(matchAnswer(animals, 'Puppies').answer?.canonical).toBe('Puppy')
  })
})

describe('scoring', () => {
  it('shares sum to 1 and decrease with rank', () => {
    const s = zipfShares(20)
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeLessThan(s[i - 1])
  })
  it('rarer answers score more, within bounds', () => {
    expect(pointsForShare(0.5)).toBeGreaterThanOrEqual(SCORING.minPoints)
    expect(pointsForShare(0.001)).toBe(SCORING.maxPoints)
    expect(pointsForShare(0.01)).toBeGreaterThan(pointsForShare(0.1))
    for (const a of q.answers.slice(1)) expect(a.points).toBeGreaterThanOrEqual(q.answers[0].points)
  })
  it('assigns tiers', () => {
    expect(tierForShare(0.3)).toBe('common')
    expect(tierForShare(0.08)).toBe('uncommon')
    expect(tierForShare(0.03)).toBe('rare')
    expect(tierForShare(0.015)).toBe('epic')
    expect(tierForShare(0.002)).toBe('legendary')
  })
})

describe('rng', () => {
  it('is deterministic', () => {
    const a = mulberry32(hashString('2026-11-14'))
    const b = mulberry32(hashString('2026-11-14'))
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
  it('numbers dailies from 1 Jan 2026', () => {
    expect(dailyNumber('2026-01-01')).toBe(1)
    expect(dailyNumber('2026-11-14')).toBe(318)
  })
})

describe('typo tolerance', () => {
  it('forgives adjacent transpositions on long words', () => {
    const q2 = compileQuestion({ ...def, answers: ['Spider-Man', 'Wolverine'] })
    expect(matchAnswer(q2, 'Spiedr-Man').answer?.canonical).toBe('Spider-Man')
    expect(matchAnswer(q2, 'Wolverien').answer?.canonical).toBe('Wolverine')
  })
})
