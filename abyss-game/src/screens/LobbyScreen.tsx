import { motion } from 'framer-motion'
import { Check, Infinity as InfinityIcon, Play, Waves } from 'lucide-react'
import { useState } from 'react'
import { Button, ScreenShell } from '../components/ui'
import { CATEGORY_META, countByCategory } from '../engine/questionBank'
import { SCORING } from '../engine/scoring'
import { CATEGORIES, type Category } from '../engine/types'
import { play } from '../lib/audio'
import { useGame } from '../state/game'
import { useProfile } from '../state/profile'
import { useUi } from '../state/ui'

type LobbyMode = 'standard' | 'endless'
const COUNTS = countByCategory()

export default function LobbyScreen() {
  const go = useUi((s) => s.go)
  const start = useGame((s) => s.start)
  const bests = useProfile((s) => s.bests)
  const [mode, setMode] = useState<LobbyMode>('standard')
  const [selected, setSelected] = useState<Category[]>([...CATEGORIES])

  const allOn = selected.length === CATEGORIES.length
  const toggle = (c: Category) => {
    play('click')
    setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))
  }
  const totalQuestions = selected.reduce((a, c) => a + COUNTS[c], 0)
  const canStart = selected.length > 0 && (mode === 'endless' || totalQuestions >= SCORING.questionsPerRun)

  const begin = () => {
    if (!canStart) return
    if (start(mode, selected)) go('game')
  }

  return (
    <ScreenShell title="Prepare your dive" subtitle="Choose a mode and the waters you want to explore" onBack={() => go('menu')}>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            { id: 'standard', icon: Waves, title: 'Standard Dive', desc: `${SCORING.questionsPerRun} questions, ${SCORING.secondsPerQuestion}s each. Descend from the sunlit shallows to the hadal trench.` },
            { id: 'endless', icon: InfinityIcon, title: 'Endless Descent', desc: `Keep going until you miss ${SCORING.endlessLives} times. Questions grow harder the deeper you sink.` },
          ] as const
        ).map((m) => {
          const active = mode === m.id
          return (
            <motion.button
              key={m.id}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                play('click')
                setMode(m.id)
              }}
              className={`glass relative overflow-hidden rounded-3xl p-5 text-left transition ${active ? 'glow-ring' : 'opacity-75 hover:opacity-100'}`}
            >
              {active && <motion.div layoutId="mode-glow" className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent/20 blur-2xl" />}
              <m.icon className="text-accent" size={26} />
              <div className="mt-3 text-lg font-semibold">{m.title}</div>
              <p className="mt-1 text-sm leading-relaxed text-mist">{m.desc}</p>
              <div className="mt-3 text-xs text-mist/80">
                Personal best: <span className="font-semibold text-ink">{bests[m.id]}</span>
              </div>
            </motion.button>
          )
        })}
      </div>

      <div className="mb-3 mt-8 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Categories</h2>
          <p className="text-sm text-mist">{totalQuestions} questions selected</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setSelected(allOn ? [] : [...CATEGORIES])}>
          {allOn ? 'Clear all' : 'Select all'}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {CATEGORIES.map((c, i) => {
          const on = selected.includes(c)
          const meta = CATEGORY_META[c]
          return (
            <motion.button
              key={c}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i }}
              onClick={() => toggle(c)}
              aria-pressed={on}
              className={`relative flex items-center gap-3 rounded-2xl border p-3.5 text-left transition ${
                on ? 'border-accent/50 bg-accent/10' : 'border-white/8 bg-white/[0.03] opacity-60 hover:opacity-90'
              }`}
            >
              <span className="text-2xl" aria-hidden>
                {meta.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{meta.label}</span>
                <span className="block text-xs text-mist">{COUNTS[c]} questions</span>
              </span>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition ${on ? 'bg-accent text-slate-950' : 'border border-white/20'}`}>
                {on && <Check size={14} strokeWidth={3} />}
              </span>
            </motion.button>
          )
        })}
      </div>

      <div className="action-dock mt-6">
        <Button variant="primary" size="lg" className="w-full text-lg" disabled={!canStart} icon={<Play size={20} fill="currentColor" />} onClick={begin}>
          {canStart ? 'Begin descent' : 'Select at least one category'}
        </Button>
      </div>
    </ScreenShell>
  )
}
