export type ThemeId = 'abyssal' | 'kelp' | 'coral' | 'violet' | 'angler' | 'aurora'

export interface Theme {
  id: ThemeId
  name: string
  description: string
  accent: string
  accent2: string
  glow: string
  unlock: { type: 'default' } | { type: 'level'; level: number } | { type: 'achievement'; id: string }
}

export const THEMES: Theme[] = [
  { id: 'abyssal', name: 'Abyssal Cyan', description: 'The classic glow of the deep.', accent: '#22d3ee', accent2: '#2dd4bf', glow: '34 211 238', unlock: { type: 'default' } },
  { id: 'kelp', name: 'Kelp Forest', description: 'Luminous greens from the swaying forest.', accent: '#4ade80', accent2: '#a3e635', glow: '74 222 128', unlock: { type: 'level', level: 3 } },
  { id: 'coral', name: 'Coral Bloom', description: 'Warm pinks of a living reef.', accent: '#fb7185', accent2: '#f9a8d4', glow: '251 113 133', unlock: { type: 'level', level: 5 } },
  { id: 'violet', name: 'Hadal Violet', description: 'The colour of the deepest trenches.', accent: '#a78bfa', accent2: '#e879f9', glow: '167 139 250', unlock: { type: 'level', level: 10 } },
  { id: 'angler', name: 'Anglerfish Gold', description: 'Earned by finding a Legendary answer.', accent: '#fbbf24', accent2: '#fde68a', glow: '251 191 36', unlock: { type: 'achievement', id: 'legendary' } },
  { id: 'aurora', name: 'Bioluminescence', description: 'Earned with a 3-day daily streak.', accent: '#38bdf8', accent2: '#c084fc', glow: '56 189 248', unlock: { type: 'achievement', id: 'daily-3' } },
]

export function isThemeUnlocked(theme: Theme, level: number, achievements: Record<string, number>): boolean {
  const u = theme.unlock
  if (u.type === 'default') return true
  if (u.type === 'level') return level >= u.level
  return Boolean(achievements[u.id])
}

export function unlockLabel(theme: Theme): string {
  const u = theme.unlock
  if (u.type === 'default') return 'Unlocked'
  if (u.type === 'level') return `Reach level ${u.level}`
  return theme.description
}

export function applyTheme(id: ThemeId) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0]
  const root = document.documentElement
  root.style.setProperty('--accent', t.accent)
  root.style.setProperty('--accent-2', t.accent2)
  root.style.setProperty('--glow', t.glow)
}
