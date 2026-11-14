import { motion } from 'framer-motion'
import { CalendarDays, Flame, Play, Share2, Trophy } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ShareModal } from '../components/ShareModal'
import { Button, ScreenShell, StatTile, Toast } from '../components/ui'
import { CATEGORY_META, dailyQuestions } from '../engine/questionBank'
import { dailyNumber, dateKey } from '../engine/rng'
import { SCORING, TIER_META } from '../engine/scoring'
import { dailyStreak } from '../lib/achievements'
import { useGame } from '../state/game'
import { useProfile } from '../state/profile'
import { useUi } from '../state/ui'

function useCountdownToMidnight() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0)
  const ms = midnight.getTime() - now
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return { label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, key: dateKey(new Date(now)) }
}

export default function DailyScreen() {
  const go = useUi((s) => s.go)
  const start = useGame((s) => s.start)
  const dailies = useProfile((s) => s.dailies)
  const history = useProfile((s) => s.history)
  const best = useProfile((s) => s.bests.daily)
  const { label, key } = useCountdownToMidnight()
  const [share, setShare] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const today = dailies[key]
  const questions = useMemo(() => dailyQuestions(key), [key])
  const streak = dailyStreak(dailies)
  const todaySummary = history.find((h) => h.mode === 'daily' && h.dailyKey === key)

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const k = dateKey(d)
    return { k, day: d.toLocaleDateString(undefined, { weekday: 'short' }), rec: dailies[k] }
  })

  return (
    <ScreenShell
      title={`Daily Challenge #${dailyNumber(key)}`}
      subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      onBack={() => go('menu')}
    >
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass relative overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative">
          <CalendarDays className="text-accent" size={28} />
          {today ? (
            <>
              <div className="mt-4 text-sm uppercase tracking-[0.16em] text-mist">Today’s score</div>
              <div className="glow-text mt-1 text-6xl font-semibold tabular-nums">{today.score}</div>
              <div className="mt-4 flex gap-1.5">
                {today.tiers.map((t, i) => (
                  <span key={i} className="h-8 flex-1 rounded-lg" style={{ background: t ? TIER_META[t].color : 'rgba(255,255,255,0.08)', boxShadow: t ? `0 0 14px ${TIER_META[t].color}55` : undefined }} />
                ))}
              </div>
              <p className="mt-4 text-mist">
                {today.correct}/{today.total} correct. Next challenge in <span className="font-semibold tabular-nums text-ink">{label}</span>
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                {todaySummary && (
                  <Button variant="primary" icon={<Share2 size={16} />} onClick={() => setShare(true)}>
                    Share result
                  </Button>
                )}
                <Button icon={<Trophy size={16} />} onClick={() => go('leaderboard')}>
                  Leaderboard
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-4 font-display text-3xl font-semibold italic">Today’s descent awaits</h2>
              <p className="mt-2 max-w-md text-mist">
                Every diver gets the same {SCORING.questionsPerRun} questions today. One attempt only — no pausing. New challenge in{' '}
                <span className="font-semibold tabular-nums text-ink">{label}</span>.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {questions.map((q, i) => (
                  <span key={q.id} className="rounded-full bg-white/5 px-3 py-1 text-xs text-mist">
                    {i + 1}. {CATEGORY_META[q.category].icon} {CATEGORY_META[q.category].label}
                  </span>
                ))}
              </div>
              <Button
                variant="primary"
                size="lg"
                className="mt-6 w-full sm:w-auto"
                icon={<Play size={18} fill="currentColor" />}
                onClick={() => {
                  if (start('daily')) go('game')
                }}
              >
                Start daily challenge
              </Button>
            </>
          )}
        </div>
      </motion.div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <StatTile label="Streak" value={<span className="inline-flex items-center gap-1.5">{streak} <Flame size={18} className="text-orange-300" /></span>} />
        <StatTile label="Best daily" value={best} />
        <StatTile label="Completed" value={Object.keys(dailies).length} />
      </div>

      <div className="glass mt-4 rounded-3xl p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-mist">Last 7 days</div>
        <div className="grid grid-cols-7 gap-2 text-center">
          {last7.map(({ k, day, rec }) => (
            <div key={k}>
              <div className={`flex aspect-square items-center justify-center rounded-xl text-xs font-semibold tabular-nums ${rec ? 'bg-accent/20 text-accent ring-1 ring-accent/40' : 'bg-white/5 text-mist/60'}`}>
                {rec ? rec.score : '–'}
              </div>
              <div className="mt-1 text-[10px] uppercase text-mist">{day}</div>
            </div>
          ))}
        </div>
      </div>

      {todaySummary && <ShareModal summary={todaySummary} open={share} onClose={() => setShare(false)} onToast={setToast} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </ScreenShell>
  )
}
