/** Levels, titles and XP. XP needed to reach level L: 150·L·(L−1). */
export function xpForLevel(level: number): number {
  return 150 * level * (level - 1)
}

export function levelForXp(xp: number): number {
  let level = 1
  while (xpForLevel(level + 1) <= xp) level++
  return level
}

export function levelProgress(xp: number) {
  const level = levelForXp(xp)
  const start = xpForLevel(level)
  const end = xpForLevel(level + 1)
  return { level, into: xp - start, needed: end - start, pct: (xp - start) / (end - start) }
}

const TITLES: [number, string][] = [
  [1, 'Snorkeler'],
  [2, 'Tide Pool Explorer'],
  [3, 'Reef Diver'],
  [5, 'Kelp Ranger'],
  [7, 'Wreck Hunter'],
  [10, 'Twilight Navigator'],
  [13, 'Midnight Cartographer'],
  [16, 'Abyssal Scholar'],
  [20, 'Hadal Legend'],
  [25, 'Leviathan'],
]

export function titleForLevel(level: number): string {
  let t = TITLES[0][1]
  for (const [lvl, name] of TITLES) if (level >= lvl) t = name
  return t
}

export function nextTitle(level: number): { level: number; title: string } | null {
  const n = TITLES.find(([lvl]) => lvl > level)
  return n ? { level: n[0], title: n[1] } : null
}

/** XP earned for a finished game. */
export function xpForGame(score: number, correct: number, completed: boolean): number {
  return score + correct * 15 + (completed ? 40 : 0)
}

export function zoneForDepth(depth: number): string {
  if (depth < 200) return 'Sunlight Zone'
  if (depth < 1000) return 'Twilight Zone'
  if (depth < 4000) return 'Midnight Zone'
  if (depth < 6000) return 'Abyssal Zone'
  return 'Hadal Zone'
}
