/**
 * Answer normalization. Produces a comparison key that ignores case, accents,
 * punctuation, extra whitespace, leading articles and a few common spelling
 * variants. Both stored answers and player input go through this function.
 */
const LEADING_ARTICLES = /^(the|a|an)\s+/

const WORD_SUBSTITUTIONS: Record<string, string> = {
  saint: 'st',
  mount: 'mt',
  mister: 'mr',
  doctor: 'dr',
  colour: 'color',
  grey: 'gray',
  centre: 'center',
  theatre: 'theater',
  aluminium: 'aluminum',
  caesium: 'cesium',
  sulphur: 'sulfur',
  and: '&',
}

const ROMAN = /^(x{0,3})(ix|iv|v?i{0,3})$/
const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10 }

function romanToNumber(word: string): string {
  let total = 0
  for (let i = 0; i < word.length; i++) {
    const v = ROMAN_VALUES[word[i]]
    const next = ROMAN_VALUES[word[i + 1]] ?? 0
    total += v < next ? -v : v
  }
  return String(total)
}

/**
 * @param strip optional extra words to drop (e.g. ["sea"] so "Red Sea" == "Red").
 */
export function normalize(raw: string, strip: readonly string[] = []): string {
  let s = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/[’‘`´]/g, "'")
    .replace(/\+/g, ' plus ')
    .replace(/#/g, ' sharp ')
    .replace(/♀/g, ' female ')
    .replace(/♂/g, ' male ')
    .replace(/&/g, ' & ')

  s = s.replace(/'s\b/g, 's') // "Raiders'" / "Hell's" variations
  s = s.replace(/[^a-z0-9& ]+/g, ' ') // punctuation → space
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(LEADING_ARTICLES, '')

  const words = s
    .split(' ')
    .map((w) => WORD_SUBSTITUTIONS[w] ?? w)
    // Roman numerals after the first word: "Henry VIII" == "Henry 8"
    .map((w, i) => (i > 0 && w && ROMAN.test(w) ? romanToNumber(w) : w))
    .filter((w) => !strip.includes(w))
  // Join without spaces so "Ice Land" == "Iceland" and "Spider-Man" == "Spiderman".
  return words.join('')
}

/** Simple singular form of an already-normalized key (for "lions" → "lion"). */
export function singularize(key: string): string[] {
  const out: string[] = []
  if (key.length > 4 && key.endsWith('ies')) out.push(key.slice(0, -3) + 'y')
  if (key.length > 4 && key.endsWith('es')) out.push(key.slice(0, -2))
  if (key.length > 3 && key.endsWith('s') && !key.endsWith('ss')) out.push(key.slice(0, -1))
  return out
}

/**
 * Edit distance (optimal string alignment): insertions, deletions,
 * substitutions and adjacent transpositions ("teh" → "the") each cost 1.
 */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] = new Array(b.length + 1).fill(0)
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j)
  let cur: number[] = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    ;[prev2, prev, cur] = [prev, cur, prev2]
  }
  return prev[b.length]
}

/** Typo tolerance by key length: short keys must match exactly. */
export function typoTolerance(length: number): number {
  if (length >= 10) return 2
  if (length >= 5) return 1
  return 0
}
