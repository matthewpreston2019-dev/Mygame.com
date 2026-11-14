import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { CATEGORY_META } from '../../engine/questionBank'
import type { Category } from '../../engine/types'
import { play } from '../../lib/audio'
import { zoneForDepth } from '../../lib/progression'

interface Props {
  first: boolean
  questionNumber: number
  totalLabel: string
  depth: number
  category: Category
  onDone: () => void
}

/**
 * Pre-question overlay. First question: 3-2-1 countdown.
 * Later questions: a short depth banner as the dive descends.
 */
export function Countdown({ first, questionNumber, totalLabel, depth, category, onDone }: Props) {
  const steps = first ? ['3', '2', '1'] : []
  const [step, setStep] = useState(0)

  useEffect(() => {
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    if (first) {
      steps.forEach((_, i) =>
        timers.push(
          setTimeout(() => {
            if (cancelled) return
            setStep(i)
            play('countdown')
          }, 300 + i * 750),
        ),
      )
      timers.push(
        setTimeout(() => {
          if (cancelled) return
          play('go')
          onDone()
        }, 300 + steps.length * 750),
      )
    } else {
      timers.push(setTimeout(() => !cancelled && onDone(), 1300))
    }
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, questionNumber])

  const meta = CATEGORY_META[category]
  return (
    <motion.div
      className="flex min-h-[60vh] flex-col items-center justify-center text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05, filter: 'blur(6px)', transition: { duration: 0.22 } }}
      transition={{ duration: 0.35 }}
    >
      <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">
        {zoneForDepth(depth)}
      </motion.div>
      <motion.div
        initial={{ y: 20, opacity: 0, letterSpacing: '0.4em' }}
        animate={{ y: 0, opacity: 1, letterSpacing: '0.08em' }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="mt-2 font-display text-5xl font-semibold italic text-ink sm:text-6xl"
      >
        {depth.toLocaleString()} m
      </motion.div>
      <div className="mt-3 text-mist">
        Question {questionNumber}
        {totalLabel} · {meta.icon} {meta.label}
      </div>
      {first && (
        <div className="relative mt-10 h-28 w-28">
          <AnimatePresence mode="popLayout">
            <motion.div
              key={step}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="glow-text absolute inset-0 flex items-center justify-center text-7xl font-semibold text-accent"
            >
              {steps[step]}
            </motion.div>
          </AnimatePresence>
          <div className="absolute inset-0 rounded-full border border-accent/30 animate-ping" />
        </div>
      )}
      {!first && (
        <motion.div className="mt-8 h-px w-40 bg-gradient-to-r from-transparent via-accent to-transparent" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1.1 }} />
      )}
    </motion.div>
  )
}
