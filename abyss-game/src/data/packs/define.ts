import type { Category, Difficulty, QuestionDef } from '../../engine/types'

type Opts = string | { fact?: string; strip?: string[]; zipf?: number }

/**
 * Compact authoring row:
 *   [id, difficulty (e/m/h), question text, answers separated by ";", fact or options]
 * Answers go from MOST to LEAST commonly given; aliases are separated by "|".
 */
export type Row = [string, 'e' | 'm' | 'h', string, string, Opts?]

const DIFF: Record<Row[1], Difficulty> = { e: 'easy', m: 'medium', h: 'hard' }

export function pack(category: Category, prefix: string, rows: Row[]): QuestionDef[] {
  return rows.map(([id, d, text, answers, opts]) => {
    const o = typeof opts === 'string' ? { fact: opts } : (opts ?? {})
    return {
      id: `${prefix}-${id}`,
      category,
      text,
      difficulty: DIFF[d],
      answers: answers
        .split(';')
        .map((a) => a.trim())
        .filter(Boolean),
      ...o,
    }
  })
}
