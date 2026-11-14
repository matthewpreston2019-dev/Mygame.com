import type { QuestionDef } from '../engine/types'
import { GENERATED_QUESTIONS } from './generated'
import animals from './packs/animals'
import entertainment from './packs/entertainment'
import food from './packs/food'
import gaming from './packs/gaming'
import geography from './packs/geography'
import history from './packs/history'
import misc from './packs/misc'
import science from './packs/science'
import sports from './packs/sports'

/**
 * All question packs. To add a pack, create a file in ./packs using `pack()`
 * and append it here — the engine compiles and validates everything at load.
 */
export const QUESTION_PACKS: { id: string; name: string; questions: QuestionDef[] }[] = [
  { id: 'core-geography', name: 'Geography', questions: geography },
  { id: 'core-animals', name: 'Animals', questions: animals },
  { id: 'core-sports', name: 'Sports', questions: sports },
  { id: 'core-science', name: 'Science', questions: science },
  { id: 'core-history', name: 'History', questions: history },
  { id: 'core-entertainment', name: 'Entertainment', questions: entertainment },
  { id: 'core-gaming', name: 'Gaming', questions: gaming },
  { id: 'core-food', name: 'Food & Drink', questions: food },
  { id: 'core-misc', name: 'Miscellaneous', questions: misc },
  { id: 'datasets', name: 'Atlas & Periodic Table', questions: GENERATED_QUESTIONS },
]

export const ALL_QUESTION_DEFS: QuestionDef[] = QUESTION_PACKS.flatMap((p) => p.questions)
