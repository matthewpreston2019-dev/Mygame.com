import { levenshtein, normalize, singularize, typoTolerance } from './normalize'
import type { MatchResult, Question } from './types'

/**
 * Match player input against a question's accepted answers.
 * Order of precedence:
 *   1. exact normalized match on canonical name or alias
 *   2. singular/plural variant of the input
 *   3. typo-tolerant match (same first letter, small edit distance, unique)
 */
export function matchAnswer(question: Question, input: string): MatchResult {
  const full = normalize(input)
  const key = question.strip.length ? normalize(input, question.strip) || full : full
  if (!key) return { answer: null, kind: 'none' }

  for (const k of new Set([full, key]))
    for (const a of question.answers) if (a.keys.includes(k)) return { answer: a, kind: 'exact' }

  const variants = [...singularize(key), ...singularize(full)]
  for (const v of variants)
    for (const a of question.answers) if (a.keys.includes(v)) return { answer: a, kind: 'exact' }

  const tol = typoTolerance(key.length)
  if (tol === 0) return { answer: null, kind: 'none' }

  let best: { idx: number; dist: number } | null = null
  let tie = false
  question.answers.forEach((a, idx) => {
    for (const k of a.keys) {
      if (k[0] !== key[0]) continue
      const d = levenshtein(key, k, Math.min(tol, typoTolerance(k.length)))
      if (d > Math.min(tol, typoTolerance(k.length))) continue
      if (!best || d < best.dist) {
        best = { idx, dist: d }
        tie = false
      } else if (d === best.dist && best.idx !== idx) {
        tie = true
      }
    }
  })
  const found = best as { idx: number; dist: number } | null
  if (found && !tie) return { answer: question.answers[found.idx], kind: 'fuzzy' }
  return { answer: null, kind: 'none' }
}
