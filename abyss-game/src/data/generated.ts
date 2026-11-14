import type { QuestionDef } from '../engine/types'
import { COUNTRIES, capitalAnswer, countryAnswer } from './datasets/countries'
import { ELEMENTS, elementAnswer } from './datasets/elements'
import { US_STATES, stateAnswer } from './datasets/usStates'

/**
 * Questions derived from structured datasets. Because each dataset is ordered
 * by how commonly an item is named, any filtered list keeps a sensible
 * popularity order for rarity scoring.
 */
const out: QuestionDef[] = []

// ── Countries ──────────────────────────────────────────────────────────────
const CONTINENTS: [string, string, string][] = [
  ['AF', 'Africa', 'easy'],
  ['AS', 'Asia', 'easy'],
  ['EU', 'Europe', 'easy'],
  ['NA', 'North America (including Central America and the Caribbean)', 'medium'],
  ['SA', 'South America', 'easy'],
  ['OC', 'Oceania', 'medium'],
]

for (const [code, label, diff] of CONTINENTS) {
  const list = COUNTRIES.filter((c) => c.continents.includes(code))
  out.push({
    id: `gen-country-${code.toLowerCase()}`,
    category: 'geography',
    text: `Name a country in ${label}`,
    difficulty: diff as QuestionDef['difficulty'],
    answers: list.map(countryAnswer),
  })
  const caps = list.filter((c) => c.capital)
  out.push({
    id: `gen-capital-${code.toLowerCase()}`,
    category: 'geography',
    text: `Name the capital city of any country in ${label.replace(/ \(.*\)/, '')}`,
    difficulty: code === 'EU' ? 'medium' : 'hard',
    answers: caps.map(capitalAnswer),
  })
}

for (const letter of 'ABCEGIKLMNPSTU') {
  const list = COUNTRIES.filter((c) => c.name.toUpperCase().startsWith(letter))
  if (list.length < 4) continue
  out.push({
    id: `gen-country-letter-${letter.toLowerCase()}`,
    category: 'geography',
    text: `Name a country whose name begins with the letter “${letter}”`,
    difficulty: list.length > 9 ? 'medium' : 'hard',
    answers: list.map(countryAnswer),
  })
}

for (const letter of 'ABKLMPST') {
  const list = COUNTRIES.filter((c) => c.capital && c.capital.toUpperCase().startsWith(letter))
  if (list.length < 5) continue
  out.push({
    id: `gen-capital-letter-${letter.toLowerCase()}`,
    category: 'geography',
    text: `Name a national capital city that begins with the letter “${letter}”`,
    difficulty: 'hard',
    answers: list.map((c) => [c.capital, ...c.capitalAliases.filter((a) => a.toUpperCase().startsWith(letter))].join('|')),
  })
}

out.push(
  {
    id: 'gen-country-landlocked',
    category: 'geography',
    text: 'Name a landlocked country',
    difficulty: 'medium',
    answers: COUNTRIES.filter((c) => c.landlocked).map(countryAnswer),
    fact: 'Liechtenstein and Uzbekistan are the world’s only “doubly landlocked” countries — surrounded entirely by other landlocked countries.',
  },
  {
    id: 'gen-country-eu-members',
    category: 'geography',
    text: 'Name a member state of the European Union',
    difficulty: 'easy',
    answers: COUNTRIES.filter((c) => c.eu).map(countryAnswer),
    fact: 'The EU has 27 member states since the United Kingdom left in 2020.',
  },
  {
    id: 'gen-country-stan',
    category: 'geography',
    text: 'Name a country whose name ends in “-stan”',
    difficulty: 'easy',
    answers: COUNTRIES.filter((c) => c.name.endsWith('stan')).map(countryAnswer),
    fact: '“-stan” comes from Persian and means “place of” or “land of”.',
  },
  {
    id: 'gen-country-guinea',
    category: 'geography',
    text: 'Name a country with “Guinea” in its name',
    difficulty: 'medium',
    answers: COUNTRIES.filter((c) => c.name.includes('Guinea')).map(countryAnswer),
  },
)

// ── US states ──────────────────────────────────────────────────────────────
const usQuestions: [string, string, (f: string, n: string) => boolean, QuestionDef['difficulty'], string?][] = [
  ['us-any', 'Name a US state', () => true, 'easy'],
  ['us-canada', 'Name a US state that borders Canada (by land or across the Great Lakes)', (f) => f.includes('C'), 'medium'],
  ['us-mexico', 'Name a US state that borders Mexico', (f) => f.includes('M'), 'easy', 'Only four US states share a land border with Mexico.'],
  ['us-colonies', 'Name one of the original Thirteen Colonies that became US states', (f) => f.includes('O'), 'medium', 'Delaware was the first state to ratify the US Constitution, in 1787.'],
  ['us-pacific', 'Name a US state with a Pacific Ocean coastline', (f) => f.includes('P'), 'easy'],
  ['us-lakes', 'Name a US state that borders one of the Great Lakes', (f) => f.includes('G'), 'medium'],
  ['us-m', 'Name a US state that begins with the letter “M”', (_, n) => n.startsWith('M'), 'easy', 'Eight states start with “M” — more than any other letter (tied with “N”).'],
  ['us-n', 'Name a US state that begins with the letter “N”', (_, n) => n.startsWith('N'), 'easy'],
  ['us-a', 'Name a US state that begins with the letter “A”', (_, n) => n.startsWith('A'), 'easy'],
  ['us-i', 'Name a US state that begins with the letter “I”', (_, n) => n.startsWith('I'), 'medium'],
  ['us-w', 'Name a US state that begins with the letter “W”', (_, n) => n.startsWith('W'), 'medium'],
  ['us-two-word', 'Name a US state whose name is two words', (_, n) => n.includes(' '), 'medium'],
]
for (const [id, text, pred, difficulty, fact] of usQuestions) {
  out.push({
    id: `gen-${id}`,
    category: 'geography',
    text,
    difficulty,
    fact,
    answers: US_STATES.filter((s) => pred(s.flags, s.name)).map(stateAnswer),
  })
}

// ── Elements ───────────────────────────────────────────────────────────────
const elementQuestions: [string, string, (e: (typeof ELEMENTS)[number]) => boolean, QuestionDef['difficulty'], string?][] = [
  ['any', 'Name a chemical element', () => true, 'easy', 'There are 118 confirmed elements; Oganesson (118) was named in 2016.'],
  ['noble', 'Name a noble gas (group 18 element)', (e) => e.group === 'ng', 'medium', 'Neon signs glow red-orange; other “neon” colours actually use different gases or coatings.'],
  ['alkali', 'Name an alkali metal (group 1, excluding hydrogen)', (e) => e.group === 'am', 'medium', 'Caesium melts at about 28 °C — it would turn liquid on a hot day.'],
  ['alkaline', 'Name an alkaline earth metal (group 2)', (e) => e.group === 'ae', 'hard'],
  ['halogen', 'Name a halogen (group 17 element)', (e) => e.group === 'hg', 'medium', '“Halogen” means “salt-former” in Greek.'],
  ['lanthanide', 'Name a lanthanide (elements 57–71)', (e) => e.group === 'ln', 'hard'],
  ['actinide', 'Name an actinide (elements 89–103)', (e) => e.group === 'an', 'hard'],
  ['one-letter', 'Name an element whose chemical symbol is a single letter', (e) => e.symbol.length === 1, 'medium', 'Only 14 elements have one-letter symbols.'],
  ['latin', 'Name an element whose symbol doesn’t start with the first letter of its English name', (e) => e.symbol[0] !== e.name[0], 'hard', 'Most of these come from Latin names: Fe (ferrum), Au (aurum), Pb (plumbum).'],
  ['ium-c', 'Name a chemical element whose name begins with “C”', (e) => e.name.startsWith('C'), 'medium'],
  ['b', 'Name a chemical element whose name begins with “B”', (e) => e.name.startsWith('B'), 'medium'],
  ['n', 'Name a chemical element whose name begins with “N”', (e) => e.name.startsWith('N'), 'medium'],
  ['s', 'Name a chemical element whose name begins with “S”', (e) => e.name.startsWith('S'), 'medium'],
  ['p', 'Name a chemical element whose name begins with “P”', (e) => e.name.startsWith('P'), 'medium'],
  ['t', 'Name a chemical element whose name begins with “T”', (e) => e.name.startsWith('T'), 'hard'],
  ['m', 'Name a chemical element whose name begins with “M”', (e) => e.name.startsWith('M'), 'medium'],
]
for (const [id, text, pred, difficulty, fact] of elementQuestions) {
  out.push({
    id: `gen-element-${id}`,
    category: 'science',
    text,
    difficulty,
    fact,
    answers: ELEMENTS.filter(pred).map(elementAnswer),
  })
}

export const GENERATED_QUESTIONS = out
