import { motion } from 'framer-motion'
import { CloudUpload, Home, RotateCcw, Share2, Sparkles, Waves } from 'lucide-react'
import { useState } from 'react'
import { ShareModal } from '../components/ShareModal'
import { Button, CountUp, ProgressBar, RarityBadge, Toast } from '../components/ui'
import { CATEGORY_META, getQuestion } from '../engine/questionBank'
import { dailyNumber } from '../engine/rng'
import { formatShare, TIER_META } from '../engine/scoring'
import { ACHIEVEMENTS } from '../lib/achievements'
import { onlineConfigured, submitOnlineScore } from '../lib/online'
import { levelProgress, titleForLevel } from '../lib/progression'
import { useGame } from '../state/game'
import { useProfile } from '../state/profile'
import { useUi } from '../state/ui'

function verdict(score: number, total: number) {
  const avg = total ? score / total : 0
  if (avg >= 75) return 'A legend of the deep.'
  if (avg >= 55) return 'You dove where few dare.'
  if (avg >= 38) return 'A confident descent.'
  if (avg >= 20) return 'Steady through the twilight.'
  return 'The surface is calling — dive again.'
}

export default function ResultsScreen() {
  const go = useUi((s) => s.go)
  const summary = useGame((s) => s.summary)!
  const outcome = useGame((s) => s.outcome)!
  const categories = useGame((s) => s.categories)
  const start = useGame((s) => s.start)
  const reset = useGame((s) => s.reset)
  const xp = useProfile((s) => s.xp)
  const name = useProfile((s) => s.name)
  const bests = useProfile((s) => s.bests)
  const [share, setShare] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [submitState, setSubmitState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  const answered = summary.results.length
  const accuracy = answered ? Math.round((summary.correct / answered) * 100) : 0
  const rarest = summary.results.filter((r) => r.answer).sort((a, b) => a.answer!.share - b.answer!.share)[0]
  const prog = levelProgress(xp)
  const levelUp = outcome.levelAfter > outcome.levelBefore
  const title = summary.mode === 'daily' && summary.dailyKey ? `Daily #${dailyNumber(summary.dailyKey)}` : summary.mode === 'endless' ? 'Endless Descent' : 'Dive complete'

  const again = () => {
    if (summary.mode === 'daily') {
      reset()
      go('lobby')
      return
    }
    start(summary.mode, categories)
  }

  const submitOnline = async () => {
    setSubmitState('sending')
    try {
      await submitOnlineScore({ name, mode: summary.mode, score: summary.score, correct: summary.correct, total: answered, dailyKey: summary.dailyKey })
      setSubmitState('done')
      setToast('Score submitted to the online leaderboard')
    } catch (e) {
      setSubmitState('error')
      setToast(e instanceof Error ? e.message : 'Submission failed')
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="text-center">
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">{title}</div>
        <div className="glow-text mt-3 text-7xl font-semibold tabular-nums sm:text-8xl">
          <CountUp value={summary.score} duration={1.6} />
        </div>
        <div className="mt-1 text-sm uppercase tracking-[0.2em] text-mist">points</div>
        <p className="mt-4 font-display text-xl italic text-ink/90">{summary.completed ? verdict(summary.score, answered) : 'You surfaced early.'}</p>
        {outcome.personalBest && (
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.4, type: 'spring' }} className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-300/15 px-4 py-1.5 text-sm font-semibold text-amber-200 ring-1 ring-amber-300/40">
            <Sparkles size={15} /> New personal best!
          </motion.div>
        )}
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-8 grid grid-cols-3 gap-3">
        <div className="glass rounded-2xl p-4 text-center">
          <div className="text-2xl font-semibold tabular-nums">
            {summary.correct}/{answered}
          </div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-mist">correct</div>
        </div>
        <div className="glass rounded-2xl p-4 text-center">
          <div className="text-2xl font-semibold tabular-nums">{accuracy}%</div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-mist">accuracy</div>
        </div>
        <div className="glass rounded-2xl p-4 text-center">
          <div className="text-2xl font-semibold tabular-nums">{bests[summary.mode]}</div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-mist">best</div>
        </div>
      </motion.div>

      {rarest?.answer && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="glass relative mt-3 overflow-hidden rounded-3xl p-5">
          <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full blur-3xl" style={{ background: `${TIER_META[rarest.answer.tier].color}40` }} />
          <div className="relative flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.14em] text-mist">Rarest find</div>
              <div className="mt-1 truncate text-xl font-semibold">{rarest.answer.canonical}</div>
              <div className="mt-0.5 truncate text-sm text-mist">{summary.questionTexts[rarest.questionId]}</div>
            </div>
            <div className="shrink-0 text-right">
              <RarityBadge tier={rarest.answer.tier} />
              <div className="mt-1.5 text-xs text-mist">{formatShare(rarest.answer.share)} of divers</div>
            </div>
          </div>
        </motion.div>
      )}

      {/* XP & level */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="glass mt-3 rounded-3xl p-5">
        <div className="flex items-center justify-between text-sm">
          <span>
            <span className="font-semibold">Level {prog.level}</span> <span className="text-mist">· {titleForLevel(prog.level)}</span>
          </span>
          <span className="font-semibold text-accent">+{outcome.xpGained} XP</span>
        </div>
        <ProgressBar value={prog.pct} className="mt-3" />
        <div className="mt-2 text-xs text-mist">
          {prog.into.toLocaleString()} / {prog.needed.toLocaleString()} XP to level {prog.level + 1}
          {levelUp && <span className="ml-2 font-semibold text-amber-200">Level up!</span>}
        </div>
      </motion.div>

      {outcome.newAchievements.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }} className="mt-3 space-y-2">
          {outcome.newAchievements.map((id) => {
            const a = ACHIEVEMENTS.find((x) => x.id === id)!
            return (
              <div key={id} className="flex items-center gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-3">
                <span className="text-2xl">{a.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-amber-100">Achievement unlocked · {a.name}</span>
                  <span className="block truncate text-xs text-amber-100/70">{a.description}</span>
                </span>
              </div>
            )
          })}
        </motion.div>
      )}

      {/* Breakdown */}
      <div className="mt-8">
        <h2 className="mb-3 px-1 text-sm font-semibold uppercase tracking-[0.14em] text-mist">Your descent</h2>
        <div className="space-y-2">
          {summary.results.map((r, i) => {
            const q = getQuestion(r.questionId)
            return (
              <motion.div
                key={`${r.questionId}-${i}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1 + i * 0.06 }}
                className="glass flex items-center gap-3 rounded-2xl p-3.5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold" style={{ background: r.answer ? `${TIER_META[r.answer.tier].color}22` : 'rgba(244,63,94,0.12)', color: r.answer ? TIER_META[r.answer.tier].color : '#fb7185' }}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{summary.questionTexts[r.questionId] ?? q?.text}</div>
                  <div className="truncate text-xs text-mist">
                    {q && CATEGORY_META[q.category].icon} {r.input ? `“${r.input}”` : 'No answer'}
                    {r.answer ? ` · ${TIER_META[r.answer.tier].label}` : ` · e.g. ${q?.answers[0]?.canonical ?? ''}`}
                  </div>
                </div>
                <span className="shrink-0 text-lg font-semibold tabular-nums" style={{ color: r.answer ? TIER_META[r.answer.tier].color : '#64748b' }}>
                  {r.points}
                </span>
              </motion.div>
            )
          })}
        </div>
      </div>

      <div className="action-dock mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Button variant="primary" size="lg" className="col-span-2" icon={summary.mode === 'daily' ? <Waves size={18} /> : <RotateCcw size={18} />} onClick={again}>
          {summary.mode === 'daily' ? 'Standard dive' : 'Dive again'}
        </Button>
        <Button size="lg" className="max-sm:!h-11" icon={<Share2 size={18} />} onClick={() => setShare(true)}>
          Share
        </Button>
        <Button
          size="lg"
          className="max-sm:!h-11"
          icon={<Home size={18} />}
          onClick={() => {
            reset()
            go('menu')
          }}
        >
          Menu
        </Button>
      </div>
      {onlineConfigured && (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" size="sm" icon={<CloudUpload size={16} />} disabled={submitState === 'sending' || submitState === 'done'} onClick={submitOnline}>
            {submitState === 'done' ? 'Submitted online' : submitState === 'sending' ? 'Submitting…' : 'Submit to online leaderboard'}
          </Button>
        </div>
      )}

      <ShareModal summary={summary} open={share} onClose={() => setShare(false)} onToast={setToast} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
