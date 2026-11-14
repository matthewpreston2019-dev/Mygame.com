import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { depthForPoints, formatShare, TIER_META } from '../../engine/scoring'
import type { Answer, Question, RoundResult } from '../../engine/types'
import { CountUp, RarityBadge } from '../ui'

interface Props {
  question: Question
  result: RoundResult
  isLast: boolean
  onNext: () => void
}

const steps = (t: number) => Math.round(t * 4) / 4

export function RevealPanel({ question, result, isLast, onNext }: Props) {
  const [showAll, setShowAll] = useState(false)
  const a = result.answer
  const tier = a?.tier

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

  const color = a ? TIER_META[a.tier].color : '#ff4f5e'
  const headline = a
    ? tier === 'legendary'
      ? '★ LEGENDARY!'
      : tier === 'epic'
        ? '★ EPIC FIND!'
        : tier === 'rare'
          ? 'RARE FIND!'
          : tier === 'uncommon'
            ? 'NICE ONE'
            : 'CORRECT'
    : result.timedOut
      ? "TIME'S UP"
      : result.input
        ? 'WRONG!'
        : 'NO ANSWER'
  const metres = depthForPoints(result.points)
  const top = question.answers.slice(0, 3)
  const rarest = question.answers.slice(-3).reverse()

  const Row = ({ ans }: { ans: Answer }) => {
    const mine = a?.canonical === ans.canonical
    return (
      <li className={`flex items-center justify-between gap-2 px-1.5 leading-tight ${mine ? 'bg-white/10' : ''}`}>
        <span className="truncate uppercase">
          {mine && <span className="text-[#ff8fab]">▸</span>}
          {ans.canonical}
        </span>
        <span className="shrink-0 tabular-nums" style={{ color: TIER_META[ans.tier].color }}>
          {formatShare(ans.share)}
        </span>
      </li>
    )
  }

  return (
    <>
      <motion.section
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
        transition={{ duration: 0.25, ease: steps }}
        className="px-box mx-auto w-full max-w-2xl p-4 sm:p-5"
        style={{ boxShadow: `0 -3px 0 0 ${color}, 0 3px 0 0 ${color}, -3px 0 0 0 ${color}, 3px 0 0 0 ${color}, inset 0 -3px 0 0 rgba(0,0,0,.35)` }}
      >
        <div className="flex items-start justify-between gap-3">
          <motion.div
            initial={{ scale: 1.6 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.3, ease: steps }}
            className="font-display px-shadow origin-left text-base sm:text-xl"
            style={{ color }}
          >
            {headline}
          </motion.div>
          {a && <RarityBadge tier={a.tier} />}
        </div>
        <div className="mt-2 truncate text-xl text-mist sm:text-2xl">
          {result.input ? (
            <>
              YOU SAID <span className="uppercase text-ink">“{result.input}”</span>
              {a && a.canonical.toLowerCase() !== result.input.toLowerCase() && <span className="uppercase text-ink"> → {a.canonical}</span>}
            </>
          ) : (
            'NO ANSWER SUBMITTED'
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="px-input px-1 py-2">
            <div className="font-display text-[7px] text-mist sm:text-[8px]">POINTS</div>
            <div className="font-display mt-1 text-sm text-[#ffd23e] sm:text-base">
              +<CountUp value={result.points} duration={0.7} />
            </div>
          </div>
          <div className="px-input px-1 py-2">
            <div className="font-display text-[7px] text-mist sm:text-[8px]">DESCENT</div>
            <div className="font-display mt-1 text-sm text-accent sm:text-base">
              {metres ? '▼' : ''}
              <CountUp value={metres} duration={1.2} />M
            </div>
          </div>
          <div className="px-input px-1 py-2">
            <div className="font-display text-[7px] text-mist sm:text-[8px]">SAID BY</div>
            <div className="font-display mt-1 text-sm sm:text-base" style={{ color }}>
              {a ? formatShare(a.share) : '—'}
            </div>
          </div>
        </div>
        {a && (
          <div className="mt-1.5 text-center text-base text-mist">
            est. share of divers · rank #{a.rank} of {question.answers.length}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3 text-lg">
          <div className="min-w-0">
            <div className="font-display mb-1 text-[7px] text-mist sm:text-[8px]">MOST COMMON</div>
            <ul>
              {top.map((x) => (
                <Row key={x.canonical} ans={x} />
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <div className="font-display mb-1 text-[7px] text-mist sm:text-[8px]">RAREST</div>
            <ul>
              {rarest.map((x) => (
                <Row key={x.canonical} ans={x} />
              ))}
            </ul>
          </div>
        </div>
        <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-lg uppercase text-accent hover:underline">
          {showAll ? '▲ hide' : '▼ show'} all {question.answers.length} answers
        </button>
        {showAll && (
          <div className="mt-1 flex max-h-36 flex-wrap gap-1 overflow-y-auto text-base">
            {question.answers.map((x) => (
              <span key={x.canonical} className="px-1.5 uppercase" style={{ background: a?.canonical === x.canonical ? '#ff6f91' : '#0e1f3d', color: a?.canonical === x.canonical ? '#fff' : TIER_META[x.tier].color }}>
                {x.canonical}
              </span>
            ))}
          </div>
        )}
        {question.fact && <p className="mt-2 border-t-2 border-dashed border-[#24406b] pt-2 text-lg leading-tight text-ink/80">◆ {question.fact}</p>}
      </motion.section>

      <div className="action-dock mx-auto mt-auto w-full max-w-2xl !mx-auto sm:!px-0">
        <button onClick={onNext} autoFocus className="px-btn px-btn-dive font-display flex h-14 w-full items-center justify-center gap-3 text-xs sm:text-sm">
          {isLast ? 'SURFACE · RESULTS ▶' : 'NEXT QUESTION ▼'}
          <span className="hidden text-[8px] opacity-80 sm:inline">[ENTER]</span>
        </button>
      </div>
    </>
  )
}
