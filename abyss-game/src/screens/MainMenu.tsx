import { motion } from 'framer-motion'
import { BarChart3, CircleHelp, Settings, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { HowToPlay } from '../components/HowToPlay'
import { Logo } from '../components/Logo'
import { QUESTIONS } from '../engine/questionBank'
import { dailyNumber, dateKey } from '../engine/rng'
import { depthForPoints } from '../engine/scoring'
import { play } from '../lib/audio'
import { levelProgress } from '../lib/progression'
import { useGame } from '../state/game'
import { useProfile } from '../state/profile'
import { useUi } from '../state/ui'

const steps = (t: number) => Math.round(t * 4) / 4

export default function MainMenu() {
  const go = useUi((s) => s.go)
  const start = useGame((s) => s.start)
  const name = useProfile((s) => s.name)
  const xp = useProfile((s) => s.xp)
  const bests = useProfile((s) => s.bests)
  const onboarded = useProfile((s) => s.onboarded)
  const setOnboarded = useProfile((s) => s.setOnboarded)
  const dailies = useProfile((s) => s.dailies)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    if (!onboarded) {
      const t = setTimeout(() => setHelp(true), 700)
      return () => clearTimeout(t)
    }
  }, [onboarded])

  const { level } = levelProgress(xp)
  const today = dateKey()
  const dailyDone = dailies[today]
  const best = Math.max(bests.standard, bests.daily)

  const dive = () => {
    play('dive')
    if (start('standard')) go('game')
  }

  const small = 'px-btn flex h-16 flex-col items-center justify-center gap-1 text-lg uppercase'

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4">
      <div className="flex items-center justify-between text-lg text-ink">
        <button onClick={() => go('profile')} className="px-box flex items-center gap-2 px-2 py-1 hover:brightness-125">
          <span className="font-display bg-accent px-1.5 py-1 text-[9px] text-[#04151c]">LV{level}</span>
          <span className="max-w-[9rem] truncate uppercase">{name}</span>
        </button>
        <span className="px-box px-2 py-1 uppercase text-mist">
          Best <span className="text-accent">{depthForPoints(best).toLocaleString('en-US')}m</span>
        </span>
      </div>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: steps }} className="mt-10 sm:mt-14">
        <Logo />
      </motion.div>

      {/* The diver bobs at the surface here. */}
      <div id="player-anchor" className="min-h-[110px] flex-1" />

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="flex flex-col gap-4">
        <p className="text-center text-xl leading-tight text-ink px-shadow">
          7 questions. One answer each. <span className="text-[#ff8fab]">The rarer your answer, the deeper you dive.</span>
        </p>
        <button onClick={dive} className="px-btn px-btn-dive font-display h-16 text-lg sm:text-xl" aria-label="Dive — start a new game">
          ▼ DIVE ▼
        </button>
        <button
          onClick={() => {
            play('click')
            go('daily')
          }}
          className="px-btn flex items-center gap-3 px-3 py-2 text-left"
        >
          <span className="font-display bg-[#ffd23e] px-2 py-2 text-[9px] text-[#2a1a00]">#{dailyNumber(today)}</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="font-display block text-[10px]">DAILY DIVE</span>
            <span className="block truncate text-lg text-mist">{dailyDone ? `Done · ${depthForPoints(dailyDone.score).toLocaleString('en-US')}m — back tomorrow` : 'Same 7 questions for everyone today'}</span>
          </span>
          {!dailyDone && <span className="blink h-3 w-3 bg-[#ffd23e]" />}
        </button>
        <div className="grid grid-cols-4 gap-3">
          <button className={small} onClick={() => go('leaderboard')}>
            <Trophy size={18} className="text-accent" />
            Ranks
          </button>
          <button className={small} onClick={() => go('profile')}>
            <BarChart3 size={18} className="text-accent" />
            Stats
          </button>
          <button className={small} onClick={() => go('settings')}>
            <Settings size={18} className="text-accent" />
            Setup
          </button>
          <button className={small} onClick={() => setHelp(true)}>
            <CircleHelp size={18} className="text-accent" />
            Help
          </button>
        </div>
        <div className="text-center text-base uppercase text-mist/80">{QUESTIONS.length} questions in the deep · works offline</div>
      </motion.div>

      <HowToPlay
        open={help}
        onClose={() => {
          setHelp(false)
          if (!onboarded) setOnboarded()
        }}
      />
    </div>
  )
}
