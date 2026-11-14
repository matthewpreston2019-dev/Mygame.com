/**
 * Original pixel-art sprites, authored as character grids.
 * Each character maps to a palette colour; '.' is transparent.
 */
export type Grid = string[]

export interface SpriteSheet {
  canvas: HTMLCanvasElement
  w: number
  h: number
}

export function bake(grid: Grid, palette: Record<string, string>, flip = false): SpriteSheet {
  const h = grid.length
  const w = grid[0].length
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = grid[y][flip ? w - 1 - x : x]
      const color = palette[ch]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return { canvas, w, h }
}

/* ── Player: "Pip", a small coral-pink octopus diver ─────────────────── */
const PIP_HEAD: Grid = [
  '....pppp....',
  '..pphhpppp..',
  '.pphhpppppp.',
  '.pppppppppp.',
  'pppppppppppp',
  'ppwwkppwwkpp',
  'ppwkkppwkkpp',
  'pppppppppppp',
  'pcpppddppppc',
  '.pppppppppp.',
]
export const PIP_FRAMES: Grid[] = [
  [...PIP_HEAD, 'pp.pp.pp.pp.', 'p..p..p..p..', 'd..d..d..d..', '............'],
  [...PIP_HEAD, '.pp.pp.pp.pp', '..p..p..p..p', '..d..d..d..d', '............'],
  // Dive pose: tentacles pulled straight and trailing.
  [...PIP_HEAD, '.pp.pppp.pp.', '.p..p..p..p.', '.p..p..p..p.', '.d..d..d..d.'],
]
export const PIP_PALETTE = { p: '#ff6f91', h: '#ffc6d4', d: '#c23d68', w: '#ffffff', k: '#160c2a', c: '#ff9db6' }

/* ── Creatures ─────────────────────────────────────────────────────── */
export const FISH: Grid = ['t...fff..', 'tt.fffff.', 'tttffffkf', 'tt.fffff.', 't...fff..']

export const JELLY: Grid = ['..jjj..', '.jjjjj.', 'jjhjjjj', 'jjjjjjj', 'j.j.j.j', 'j.j.j.j', '..j.j..', '.j...j.', '..j.j..']

export const SQUID: Grid = ['..ss..', '.ssss.', 'ssssss', 'ssssss', 'skssks', 'ssssss', 's.ss.s', 's.s.s.', '.s.s.s', 's...s.']

export const ANGLER: Grid = [
  '........a...',
  '..bbbbb..a..',
  '.bbbbbbbb.L.',
  'bbbbbbbwkb..',
  'bbbbbbbbbbb.',
  'tbbbbbbzzzbb',
  'tt.bbbbbbbb.',
  't...bbbbb...',
]

/* ── 3×5 pixel digits for the depth ruler ──────────────────────────── */
export const DIGITS: Record<string, Grid> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  m: ['...', '...', '###', '###', '#.#'],
}
