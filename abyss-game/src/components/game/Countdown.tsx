import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { CATEGORY_META } from '../../engine/questionBank'
import type { Category } from '../../engine/types'
import { play } from '../../lib/audio'

interface Props {
  first: boolean
  questionNumber: number
  total: number
  category: Category
  onDone: () => void
}

const steps = (t: number) => Math.round(t * 4) / 4

/**
 * Pre-question banner. First question: 3-2-1-DIVE countdown.
 * Later questions: a short "QUESTION n" card while the diver settles.
 */
export function Countdown({ first, questionNumber, total, category, onDone }: Props) {
  const labels = first ? ['3', '2', '1', 'DIVE!'] : []
  const [step, setStep] = useState(-1)

  useEffect(() => {
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    if (first) {
      labels.forEach((_, i) =>
        timers.push(
          setTimeout(() => {
            if (cancelled) return
            setStep(i)
            play(i === labels.length - 1 ? 'go' : 'countdown')
          }, 250 + i * 650),
        ),
      )
      timers.push(setTimeout(() => !cancelled && onDone(), 250 + labels.length * 650))
    } else {
      timers.push(setTimeout(() => !cancelled && onDone(), 1100))
    }
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, questionNumber])

  const meta = CATEGORY_META[category]
  return (
    <motion.section
      className="px-box mx-auto w-full max-w-md p-5 text-center"
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.1, transition: { duration: 0.12 } }}
      transition={{ duration: 0.25, ease: steps }}
    >
      <div className="font-display text-[9px] text-mist">{first ? 'GET READY, DIVER' : 'NEXT QUESTION'}</div>
      <div className="font-display px-shadow mt-3 text-xl text-accent sm:text-2xl">
        Q{questionNumber}
        <span className="text-mist">/{total}</span>
      </div>
      <div className="mt-2 text-xl uppercase text-mist">
        {meta.icon} {meta.label}
      </div>
      {first && (
        <div className="relative mt-4 h-16">
          <AnimatePresence mode="popLayout">
            {step >= 0 && (
              <motion.div
                key={step}
                initial={{ scale: 2.2, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ duration: 0.25, ease: steps }}
                className={`font-display px-shadow absolute inset-0 flex items-center justify-center ${step === labels.length - 1 ? 'text-2xl text-[#ff6f91]' : 'text-4xl text-[#ffd23e]'}`}
              >
                {labels[step]}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.section>
  )
}
