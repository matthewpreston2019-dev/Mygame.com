import { motion } from 'framer-motion'
import { ArrowRight, Check, Clock, Lightbulb, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatShare, TIER_META } from '../../engine/scoring'
import type { Question, RoundResult } from '../../engine/types'
import { Button, CountUp, RarityBadge } from '../ui'
import { Celebration } from './Celebration'

interface Props {
  question: Question
  result: RoundResult
  isLast: boolean
  livesLeft?: number
  onNext: () => void
}

export function RevealPanel({ question, result, isLast, livesLeft, onNext }: Props) {
  const [showAll, setShowAll] = useState(false)
  const a = result.answer
  const tier = a?.tier
  const celebrate = tier === 'rare' || tier === 'epic' || tier === 'legendary'

  useEffect(() => {
    const armedAt = Date.now()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || Date.now() - armedAt < 450) return
      e.preventDefault()
      onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNext])

  const top = question.answers.slice(0, 5)
  const rarest = question.answers.slice(-3).reverse()
  const maxShare = question.answers[0].share
  const headline = a ? (tier === 'legendary' ? 'Legendary find!' : tier === 'epic' ? 'Epic find!' : tier === 'rare' ? 'Rare find!' : 'Correct!') : result.timedOut ? 'Time’s up' : result.input ? 'Not quite' : 'No answer'
  const color = a ? TIER_META[a.tier].color : '#fb7185'

  const Row = ({ ans }: { ans: (typeof question.answers)[number] }) => {
    const mine = a?.canonical === ans.canonical
    return (
      <div className={`relative overflow-hidden rounded-xl px-3 py-2 ${mine ? 'ring-1 ring-accent' : ''}`}>
        <div className="absolute inset-y-0 left-0 rounded-xl opacity-20" style={{ width: `${(ans.share / maxShare) * 100}%`, background: TIER_META[ans.tier].color }} />
        <div className="relative flex items-center justify-between gap-3 text-sm">
          <span className="truncate">
            {mine && <span className="mr-1 text-accent">▸</span>}
            {ans.canonical}
          </span>
          <span className="flex shrink-0 items-center gap-2 tabular-nums text-mist">
            <span className="text-xs">{formatShare(ans.share)}</span>
            <span className="w-7 text-right font-semibold" style={{ color: TIER_META[ans.tier].color }}>
              {ans.points}
            </span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16, transition: { duration: 0.2 } }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
      {celebrate && tier && <Celebration tier={tier} />}

      <div className="glass relative overflow-hidden rounded-3xl p-5 sm:p-7">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl" style={{ background: `${color}33` }} />
        <div className="relative flex items-start gap-4">
          <motion.div
            initial={{ scale: 0, rotate: -40 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.1 }}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
            style={{ background: `${color}22`, color, boxShadow: `inset 0 0 0 1px ${color}66` }}
          >
            {a ? <Check size={28} strokeWidth={3} /> : result.timedOut ? <Clock size={26} /> : <X size={28} strokeWidth={3} />}
          </motion.div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-2xl font-semibold italic sm:text-3xl" style={{ color }}>
              {headline}
            </div>
            <div className="mt-1 truncate text-mist">
              {result.input ? (
                <>
                  You said <span className="font-medium text-ink">“{result.input}”</span>
                  {a && a.canonical.toLowerCase() !== result.input.toLowerCase() && (
                    <>
                      {' '}
                      → <span className="text-ink">{a.canonical}</span>
                    </>
                  )}
                </>
              ) : (
                'You didn’t submit an answer.'
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-4xl font-semibold leading-none" style={{ color: a ? color : undefined }}>
              +<CountUp value={result.points} duration={0.9} />
            </div>
            <div className="mt-1 text-xs uppercase tracking-[0.14em] text-mist">points</div>
          </div>
        </div>
        {a && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="relative mt-4 flex flex-wrap items-center gap-3 text-sm text-mist">
            <RarityBadge tier={a.tier} />
            <span>
              An estimated <b className="text-ink">{formatShare(a.share)}</b> of divers give this answer · rank #{a.rank} of {question.answers.length}
            </span>
          </motion.div>
        )}
        {livesLeft !== undefined && !a && (
          <div className="relative mt-4 text-sm text-rose-300">{livesLeft > 0 ? `${livesLeft} ${livesLeft === 1 ? 'life' : 'lives'} left` : 'Out of air — your dive ends here.'}</div>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="glass rounded-3xl p-4">
          <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-mist">Most common answers</div>
          <div className="space-y-1">
            {top.map((ans) => (
              <Row key={ans.canonical} ans={ans} />
            ))}
          </div>
        </div>
        <div className="glass rounded-3xl p-4">
          <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-mist">Rarest correct answers</div>
          <div className="space-y-1">
            {rarest.map((ans) => (
              <Row key={ans.canonical} ans={ans} />
            ))}
          </div>
          <button onClick={() => setShowAll((v) => !v)} className="mt-2 w-full rounded-xl px-3 py-2 text-left text-sm text-accent hover:bg-white/5">
            {showAll ? 'Hide' : 'Show'} all {question.answers.length} accepted answers
          </button>
        </div>
      </div>

      {showAll && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="glass mt-4 overflow-hidden rounded-3xl p-4">
          <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
            {question.answers.map((ans) => (
              <span
                key={ans.canonical}
                className={`rounded-lg px-2 py-1 text-xs ${a?.canonical === ans.canonical ? 'bg-accent text-slate-950' : 'bg-white/5 text-ink/85'}`}
                title={`${formatShare(ans.share)} · ${ans.points} pts`}
              >
                {ans.canonical}
              </span>
            ))}
          </div>
        </motion.div>
      )}

      {question.fact && (
        <div className="mt-4 flex gap-3 rounded-3xl border border-white/8 bg-white/[0.03] p-4 text-sm leading-relaxed text-ink/85">
          <Lightbulb size={18} className="mt-0.5 shrink-0 text-accent" />
          <span>{question.fact}</span>
        </div>
      )}

      <div className="action-dock mt-4">
        <Button variant="primary" size="lg" className="w-full text-lg" icon={<ArrowRight size={20} />} onClick={onNext} autoFocus>
          {isLast ? 'See results' : 'Dive deeper'}
          <span className="ml-1 hidden rounded-md bg-slate-950/20 px-1.5 py-0.5 text-xs font-medium sm:inline">Enter</span>
        </Button>
      </div>
    </motion.div>
  )
}
