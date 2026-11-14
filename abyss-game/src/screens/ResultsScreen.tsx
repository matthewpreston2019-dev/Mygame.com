import { motion } from 'framer-motion'
import { useState } from 'react'
import { ShareModal } from '../components/ShareModal'
import { Button, CountUp, RarityBadge, Toast } from '../components/ui'
import { getQuestion } from '../engine/questionBank'
import { dailyNumber } from '../engine/rng'
import { depthForPoints, TIER_META } from '../engine/scoring'
import type { RoundResult } from '../engine/types'
import { ACHIEVEMENTS } from '../lib/achievements'
import { onlineConfigured, submitOnlineScore } from '../lib/online'
import { levelProgress, zoneForDepth } from '../lib/progression'
import { useGame } from '../state/game'
import { useProfile } from '../state/profile'
import { useUi } from '../state/ui'

const steps = (t: number) => Math.round(t * 5) / 5

/** Step chart of the descent: one drop per question, coloured by rarity. */
function DepthGraph({ results }: { results: RoundResult[] }) {
  const W = 320
  const H = 150
  const padL = 34
  const padB = 16
  const max = Math.max(1500, ...[results.reduce((a, r) => a + depthForPoints(r.points), 0)])
  const yMax = Math.ceil(max / 1500) * 1500
  const n = results.length
  const xOf = (i: number) => padL + ((W - padL - 6) * i) / Math.max(1, n)
  const yOf = (m: number) => 6 + ((H - padB - 6) * m) / yMax
  let depth = 0
  const segs = results.map((r, i) => {
    const from = depth
    depth += depthForPoints(r.points)
    return { i, from, to: depth, r }
  })
  const gridLines = Array.from({ length: yMax / 1500 + 1 }, (_, k) => k * 1500)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" shapeRendering="crispEdges" role="img" aria-label={`Depth graph: final depth ${depth} metres`}>
      <rect x={padL} y={6} width={W - padL - 6} height={H - padB - 6} fill="#030814" />
      {gridLines.map((m) => (
        <g key={m}>
          <rect x={padL} y={Math.round(yOf(m))} width={W - padL - 6} height={1} fill="#16284a" />
          <text x={padL - 4} y={Math.round(yOf(m)) + 3} textAnchor="end" fontFamily="VT323, monospace" fontSize="11" fill="#8fb3cf">
            {m >= 1000 ? `${m / 1000}k` : m}
          </text>
        </g>
      ))}
      {segs.map(({ i, from, to, r }) => {
        const color = r.answer ? TIER_META[r.answer.tier].color : '#ff4f5e'
        const x0 = Math.round(xOf(i))
        const x1 = Math.round(xOf(i + 1))
        return (
          <motion.g key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.12, duration: 0.1 }}>
            <rect x={x0} y={Math.round(yOf(from))} width={x1 - x0} height={3} fill="#3ee8e0" opacity={0.5} />
            <rect x={x1 - 3} y={Math.round(yOf(from))} width={3} height={Math.max(3, Math.round(yOf(to) - yOf(from)))} fill={color} />
            <rect x={x1 - 5} y={Math.round(yOf(to)) - 2} width={7} height={7} fill={color} stroke="#000" strokeWidth={1} />
            <text x={Math.round((x0 + x1) / 2)} y={H - 3} textAnchor="middle" fontFamily="VT323, monospace" fontSize="11" fill="#8fb3cf">
              Q{i + 1}
            </text>
          </motion.g>
        )
      })}
    </svg>
  )
}

export default function ResultsScreen() {
  const go = useUi((s) => s.go)
  const summary = useGame((s) => s.summary)!
  const outcome = useGame((s) => s.outcome)!
  const start = useGame((s) => s.start)
  const reset = useGame((s) => s.reset)
  const xp = useProfile((s) => s.xp)
  const name = useProfile((s) => s.name)
  const history = useProfile((s) => s.history)
  const [share, setShare] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [submitState, setSubmitState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  const answered = summary.results.length
  const finalDepth = depthForPoints(summary.score)
  const prog = levelProgress(xp)
  const title = summary.mode === 'daily' && summary.dailyKey ? `DAILY DIVE #${dailyNumber(summary.dailyKey)}` : summary.completed ? 'DIVE COMPLETE' : 'SURFACED EARLY'

  // Genuine comparison data only: this player's own previous finished dives.
  const previous = history.filter((h) => h.id !== summary.id && h.completed && h.mode !== 'endless')
  const percentile = previous.length >= 3 ? Math.round((previous.filter((h) => h.score < summary.score).length / previous.length) * 100) : null

  const again = () => start('standard')

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
    <div className="mx-auto w-full max-w-2xl px-3 pb-8 pt-4 sm:px-6 sm:pt-8">
      <div id="player-anchor" className="h-24 sm:h-28" />
      <motion.section initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: steps }} className="px-box px-box-hi p-4 text-center sm:p-6">
        <div className="font-display text-[9px] text-mist sm:text-[10px]">{title}</div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="px-input py-3">
            <div className="font-display text-[8px] text-mist">FINAL DEPTH</div>
            <div className="font-display px-shadow mt-2 text-lg text-accent sm:text-2xl">
              <CountUp value={finalDepth} duration={1.6} />M
            </div>
            <div className="mt-1 text-lg uppercase text-mist">{zoneForDepth(finalDepth)}</div>
          </div>
          <div className="px-input py-3">
            <div className="font-display text-[8px] text-mist">SCORE</div>
            <div className="font-display px-shadow mt-2 text-lg text-[#ffd23e] sm:text-2xl">
              <CountUp value={summary.score} duration={1.6} />
            </div>
            <div className="mt-1 text-lg uppercase text-mist">
              {summary.correct}/{answered} correct
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xl">
          {outcome.personalBest && <span className="font-display blink text-[9px] text-[#ffd23e]">★ NEW BEST ★</span>}
          {percentile !== null && (
            <span className="text-mist">
              Deeper than <b className="text-ink">{percentile}%</b> of your past {previous.length} dives
            </span>
          )}
          <span className="text-accent">+{outcome.xpGained} XP · LV {prog.level}</span>
        </div>
      </motion.section>

      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="px-box mt-4 p-3 sm:p-4">
        <div className="font-display mb-2 text-[8px] text-mist">DESCENT LOG</div>
        <DepthGraph results={summary.results} />
      </motion.section>

      <section className="px-box mt-4 p-3 sm:p-4">
        <div className="font-display mb-2 text-[8px] text-mist">DIVE HISTORY</div>
        <ol className="space-y-2">
          {summary.results.map((r, i) => {
            const q = getQuestion(r.questionId)
            const color = r.answer ? TIER_META[r.answer.tier].color : '#ff4f5e'
            return (
              <motion.li
                key={`${r.questionId}-${i}`}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.08, duration: 0.15, ease: steps }}
                className="flex items-center gap-3 bg-[#030814]/70 p-2"
                style={{ boxShadow: `inset 3px 0 0 ${color}` }}
              >
                <span className="font-display w-5 shrink-0 text-center text-[10px]" style={{ color }}>
                  {r.answer ? '✓' : '✗'}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-lg text-mist">{summary.questionTexts[r.questionId] ?? q?.text}</div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xl uppercase">
                    <span className="truncate text-ink">{r.input ? r.answer?.canonical ?? r.input : '—'}</span>
                    {r.answer ? <RarityBadge tier={r.answer.tier} size="sm" /> : <span className="text-base text-mist">e.g. {q?.answers[q.answers.length - 1]?.canonical}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right leading-tight">
                  <div className="font-display text-[10px] text-[#ffd23e]">+{r.points}</div>
                  <div className="text-lg text-accent">▼{depthForPoints(r.points)}m</div>
                </div>
              </motion.li>
            )
          })}
        </ol>
      </section>

      {outcome.newAchievements.length > 0 && (
        <section className="mt-4 space-y-2">
          {outcome.newAchievements.map((id) => {
            const a = ACHIEVEMENTS.find((x) => x.id === id)!
            return (
              <div key={id} className="px-box flex items-center gap-3 p-3" style={{ boxShadow: '0 0 0 3px #ffd23e' }}>
                <span className="text-2xl">{a.icon}</span>
                <span className="min-w-0 leading-tight">
                  <span className="font-display block text-[8px] text-[#ffd23e]">ACHIEVEMENT · {a.name.toUpperCase()}</span>
                  <span className="block truncate text-lg text-mist">{a.description}</span>
                </span>
              </div>
            )
          })}
        </section>
      )}

      <div className="action-dock mt-4 grid grid-cols-2 gap-3 sm:!mx-0 sm:!px-0">
        <Button variant="primary" size="lg" className="col-span-2" onClick={again} autoFocus>
          ▼ Dive again
        </Button>
        <Button size="lg" onClick={() => setShare(true)}>
          Share
        </Button>
        <Button
          size="lg"
          onClick={() => {
            reset()
            go('menu')
          }}
        >
          Menu
        </Button>
      </div>
      {onlineConfigured && (
        <div className="mt-2 flex justify-center">
          <Button variant="ghost" size="sm" disabled={submitState === 'sending' || submitState === 'done'} onClick={submitOnline}>
            {submitState === 'done' ? 'Submitted online' : submitState === 'sending' ? 'Submitting…' : 'Submit to online leaderboard'}
          </Button>
        </div>
      )}

      <ShareModal summary={summary} open={share} onClose={() => setShare(false)} onToast={setToast} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
