import { normalize } from './normalize'
import { pointsForShare, tierForShare, zipfShares } from './scoring'
import type { Answer, Question, QuestionDef } from './types'

/** Turn an authored QuestionDef into a playable Question with rarity data. */
export function compileQuestion(def: QuestionDef): Question {
  const shares = zipfShares(def.answers.length, def.zipf)
  const answers: Answer[] = def.answers.map((raw, i) => {
    const [canonical, ...aliases] = raw.split('|').map((s) => s.trim()).filter(Boolean)
    const strip = (def.strip ?? []).map((w) => normalize(w))
    const names = [canonical, ...aliases]
    const keys = Array.from(
      new Set([...names.map((n) => normalize(n)), ...names.map((n) => normalize(n, strip))]),
    ).filter(Boolean)
    const share = shares[i]
    return {
      canonical,
      aliases,
      keys,
      rank: i + 1,
      share,
      points: pointsForShare(share),
      tier: tierForShare(share),
    }
  })
  return {
    id: def.id,
    category: def.category,
    text: def.text,
    difficulty: def.difficulty,
    answers,
    fact: def.fact,
    strip: (def.strip ?? []).map((w) => normalize(w)),
  }
}
