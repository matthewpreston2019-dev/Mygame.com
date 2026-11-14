# ABYSS — Deep Trivia

*Dive deeper. Answer rarer.*

ABYSS is a deep-ocean trivia game. Every question has many correct answers ("Name a country in South America"). You get one answer and 25 seconds, and **rarer correct answers score more**. Seven questions take you from the sunlit shallows down to the hadal trench.

This is a standalone project. It doesn't depend on any other project in this repository.

## Run it

```bash
cd abyss-game
npm install
npm run dev          # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint |
| `npm test` | Unit tests plus validation of the whole question database |

## Features

- **Standard Dive**: 7 questions, 25 s each, with difficulty rising as you descend. You can pick which categories to include.
- **Daily Challenge**: one deterministic set of 7 questions per calendar date, the same for every player. You get one attempt, with no pausing. It tracks streaks and shows the last 7 days.
- **Endless Descent**: keep answering until you've missed 3 times. Questions get harder the deeper you go.
- **Rarity scoring**: the reveal shows rarity tiers (Common → Legendary), the estimated share of players for your answer, the most common and rarest answers, every accepted answer and a fact.
- **Progression**: XP and levels, diver titles, 15 achievements and 6 unlockable glow themes.
- **Statistics**: accuracy, streaks, best rarity, per-category stats, a tier histogram and game history.
- **Leaderboards**: a working local leaderboard, plus an optional online one that stays clearly separate.
- **Share cards**: a generated PNG card plus an emoji text summary, with copy, save or native share.
- **Settings**: sound toggle and volume, countdown ticks, reduced motion, diver name, export/import of progress, cloud save (optional) and reset.
- Synthesized sound effects through Web Audio, so there are no audio files. Fonts are bundled, so the game works fully offline.
- Enter to submit and to continue. A pause and an exit confirmation stop accidental loss of a run. The timer is based on a deadline, so it can't stall.

## Scoring (configurable in `src/engine/scoring.ts`)

1. Answers in each question are written **in order from most to least common**. Each answer's estimated share of players follows a Zipf distribution over its rank: `share ∝ 1 / rank^1.15`.
2. `points = 10 + 90 × min(1, log(1/share) / log(200))`. Each halving of popularity adds the same number of points. Anything at or below a 0.5% share scores 100.
3. Wrong answers or no answer score 0.

Tiers by share: Common ≥ 15%, Uncommon ≥ 6%, Rare ≥ 2.5%, Epic ≥ 1%, Legendary < 1%.

The popularity rankings are curated estimates, not crowd data. The UI says "estimated" wherever it shows a share.

## Question engine

- **283 questions** and **6,863 accepted answers** across geography, animals, sports, science, history, entertainment, gaming, food and miscellany.
- Handwritten packs live in `src/data/packs/*.ts`. More questions are generated from structured datasets in `src/data/datasets` (all 118 elements, all 50 US states, about 200 countries with capitals, continents, landlocked status and EU membership).
- Answer matching (`src/engine/normalize.ts`, `matcher.ts`) handles:
  - case, accents, punctuation, spacing and leading articles
  - `&`/`and`, `St.`/`Saint`
  - Roman numerals (`Henry VIII` = `Henry 8`)
  - British/American spellings (colour/color, aluminium/aluminum, …)
  - plurals and per-question filler words (`Red Sea` = `Red`)
  - aliases
  - typo tolerance through Damerau distance: 1 edit for 5+ characters, 2 edits for 10+. The first letter must match and the match must be unambiguous.
- `npm test` checks every question: unique IDs, no match key shared between two answers in the same question, every alias resolving to its own answer, and complete datasets.

### Adding a question pack

```ts
// src/data/packs/oceans.ts
import { pack } from './define'
export default pack('science', 'ocean', [
  ['trenches', 'h', 'Name an ocean trench', 'Mariana; Tonga; Kermadec; Kuril–Kamchatka|Kuril; Philippine', { strip: ['trench'], fact: '…' }],
])
```

Then register it in `src/data/index.ts` and run `npm test`.

## Online features (optional)

The game is fully playable with no backend. Profile, stats, history, achievements, themes and the local leaderboard all persist in `localStorage`.

To enable the **online leaderboard** and **cloud save**:

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Enable **Authentication → Anonymous sign-ins**.
3. Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then restart the dev server or rebuild.

Players are signed in anonymously, so there's no email or password. The SDK is lazy-loaded and only downloaded when online features are configured. Row-level security limits each user to inserting their own scores and reading or writing their own cloud save. Scores are submitted by the client, so they can't be fully protected against tampering. For competitive use, validate runs server-side (for example with an Edge Function that replays answers).

## Architecture

```
src/
  engine/      types, normalization, matching, scoring, seeded RNG, question selection
  data/        datasets, question packs, generated questions
  state/       zustand stores: game state machine, persisted profile, navigation
  lib/         audio synth, achievements, progression, cosmetics, share card, online layer
  components/  ocean background, UI kit, game widgets (timer, countdown, reveal, celebration)
  screens/     menu, lobby, game, results, daily, leaderboard, profile, settings
```

Stack: React 19, TypeScript, Vite, Tailwind CSS 4, Framer Motion, Zustand, optional Supabase.
