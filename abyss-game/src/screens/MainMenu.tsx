import { motion } from 'framer-motion'
import { BarChart3, CalendarDays, CircleHelp, Play, Settings, Trophy, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { HowToPlay } from '../components/HowToPlay'
import { Logo } from '../components/Logo'
import { Button } from '../components/ui'
import { QUESTIONS } from '../engine/questionBank'
import { dailyNumber, dateKey } from '../engine/rng'
import { play } from '../lib/audio'
import { levelProgress, titleForLevel } from '../lib/progression'
import { useProfile } from '../state/profile'
import { useUi } from '../state/ui'

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.25 } } }
const item = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } } }

export default function MainMenu() {
  const go = useUi((s) => s.go)
  const name = useProfile((s) => s.name)
  const xp = useProfile((s) => s.xp)
  const onboarded = useProfile((s) => s.onboarded)
  const setOnboarded = useProfile((s) => s.setOnboarded)
  const dailies = useProfile((s) => s.dailies)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    if (!onboarded) {
      const t = setTimeout(() => setHelp(true), 900)
      return () => clearTimeout(t)
    }
  }, [onboarded])

  const { level, pct } = levelProgress(xp)
  const today = dateKey()
  const dailyDone = dailies[today]

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pb-8 pt-5 sm:px-6">
      <motion.button
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        onClick={() => {
          play('click')
          go('profile')
        }}
        className="glass flex items-center gap-3 self-end rounded-2xl py-1.5 pl-1.5 pr-4 text-left transition hover:bg-white/10"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-2 text-sm font-bold text-slate-950">
          {level}
        </span>
        <span className="min-w-0">
          <span className="block max-w-[160px] truncate text-sm font-semibold">{name}</span>
          <span className="relative mt-1 block h-1 w-28 overflow-hidden rounded-full bg-white/10">
            <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct * 100}%` }} />
          </span>
        </span>
      </motion.button>

      <div className="flex flex-1 flex-col justify-center py-10">
        <motion.div initial={{ opacity: 0, scale: 0.94, filter: 'blur(10px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} className="animate-bob">
          <Logo />
        </motion.div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }} className="mt-4 text-center font-display text-lg italic text-mist sm:text-xl">
          Dive deeper. Answer rarer.
        </motion.p>

        <motion.div variants={container} initial="hidden" animate="show" className="mt-10 flex flex-col gap-3">
          <motion.div variants={item}>
            <Button variant="primary" size="lg" className="w-full text-lg" icon={<Play size={20} fill="currentColor" />} onClick={() => go('lobby')}>
              Dive
            </Button>
          </motion.div>
          <motion.button
            variants={item}
            onClick={() => {
              play('click')
              go('daily')
            }}
            className="glass group flex items-center gap-4 rounded-2xl p-4 text-left transition hover:bg-white/10"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <CalendarDays size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Daily Challenge #{dailyNumber(today)}</span>
              <span className="block truncate text-sm text-mist">
                {dailyDone ? `Completed · ${dailyDone.score} pts — come back tomorrow` : 'Same 7 questions for every diver today'}
              </span>
            </span>
            {!dailyDone && <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_12px_var(--accent)] animate-pulse-glow" />}
          </motion.button>
          <motion.div variants={item} className="grid grid-cols-3 gap-3">
            <Button size="lg" className="flex-col !h-20 !gap-1 text-sm" icon={<Trophy size={20} className="text-accent" />} onClick={() => go('leaderboard')}>
              Leaderboard
            </Button>
            <Button size="lg" className="flex-col !h-20 !gap-1 text-sm" icon={<BarChart3 size={20} className="text-accent" />} onClick={() => go('profile')}>
              <span className="hidden min-[380px]:inline">Statistics</span>
              <span className="min-[380px]:hidden">Stats</span>
            </Button>
            <Button size="lg" className="flex-col !h-20 !gap-1 text-sm" icon={<Settings size={20} className="text-accent" />} onClick={() => go('settings')}>
              Settings
            </Button>
          </motion.div>
          <motion.div variants={item} className="flex justify-center">
            <Button variant="ghost" size="sm" icon={<CircleHelp size={16} />} onClick={() => setHelp(true)}>
              How to play
            </Button>
          </motion.div>
        </motion.div>
      </div>

      <motion.footer initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="flex items-center justify-center gap-2 text-xs text-mist/70">
        <User size={12} /> {titleForLevel(level)} · {QUESTIONS.length} questions in the deep
      </motion.footer>

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
