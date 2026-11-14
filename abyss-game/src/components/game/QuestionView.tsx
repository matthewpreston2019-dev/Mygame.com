import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { CATEGORY_META } from '../../engine/questionBank'
import { SCORING } from '../../engine/scoring'
import type { Question } from '../../engine/types'
import { play } from '../../lib/audio'
import { useGame } from '../../state/game'
import { useProfile } from '../../state/profile'
import { TimerRing } from './TimerRing'

const TOTAL = SCORING.secondsPerQuestion * 1000
const steps = (t: number) => Math.round(t * 4) / 4

export function QuestionView({ question, number, total }: { question: Question; number: number; total: number }) {
  const deadline = useGame((s) => s.deadline)
  const paused = useGame((s) => s.paused)
  const submit = useGame((s) => s.submit)
  const ticks = useProfile((s) => s.settings.showTimerTicks)
  const [value, setValue] = useState('')
  const [remaining, setRemaining] = useState(TOTAL)
  const [shake, setShake] = useState(0)
  const valueRef = useRef(value)
  const inputRef = useRef<HTMLInputElement>(null)
  valueRef.current = value

  // Deadline-based timer: immune to dropped frames and background tabs.
  useEffect(() => {
    if (paused !== null) {
      setRemaining(paused)
      return
    }
    let lastSecond = Math.ceil((deadline - Date.now()) / 1000)
    const id = setInterval(() => {
      const left = Math.max(0, deadline - Date.now())
      setRemaining(left)
      const sec = Math.ceil(left / 1000)
      if (sec !== lastSecond) {
        lastSecond = sec
        if (ticks && sec <= 5 && sec > 0) play('tickUrgent')
        else if (ticks && sec <= 10 && sec > 0) play('tick')
      }
      if (left <= 0) {
        clearInterval(id)
        submit(valueRef.current, true)
      }
    }, 100)
    return () => clearInterval(id)
  }, [deadline, paused, submit, ticks])

  useEffect(() => {
    if (paused === null) inputRef.current?.focus({ preventScroll: true })
  }, [paused, question.id])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) {
      setShake((n) => n + 1)
      inputRef.current?.focus()
      return
    }
    play('dive')
    submit(value)
  }

  const meta = CATEGORY_META[question.category]
  const hidden = paused !== null
  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16, transition: { duration: 0.15 } }}
        transition={{ duration: 0.3, ease: steps }}
        className="px-box mx-auto w-full max-w-2xl p-4 sm:p-6"
      >
        <div className="flex items-center justify-between gap-3 font-display text-[8px] uppercase sm:text-[10px]">
          <span className="text-accent">
            QUESTION {number}
            <span className="text-mist">/{total}</span>
          </span>
          <span className="truncate text-mist">
            {meta.icon} {meta.label}
          </span>
        </div>
        <div role="heading" aria-level={2} className={`mt-2 text-[22px] leading-[1.05] text-ink sm:mt-4 sm:text-[40px] ${hidden ? 'blur-md select-none' : ''}`}>
          {question.text}
        </div>
        <p className="mt-3 border-t-2 border-dashed border-[#24406b] pt-2 text-base leading-tight text-mist sm:text-xl">
          <span className="text-[#ff8fab]">▸</span> Name a correct answer few other divers would say. The rarer it is, the deeper you sink.
          <span className="text-mist/70"> ({question.answers.length} accepted)</span>
        </p>
      </motion.section>

      <div className="action-dock mx-auto mt-auto w-full max-w-2xl !mx-auto sm:!px-0">
        <motion.form
          key={shake}
          onSubmit={onSubmit}
          animate={shake ? { x: [0, -6, 6, -4, 4, 0] } : undefined}
          transition={{ duration: 0.3, ease: steps }}
          className="flex items-center gap-3 sm:gap-4"
        >
          <TimerRing remainingMs={remaining} totalMs={TOTAL} paused={hidden} />
          <label className="px-input flex h-14 min-w-0 flex-1 items-center gap-2 px-3">
            <span className="blink font-display text-xs text-accent">&gt;</span>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value.slice(0, 80))}
              disabled={hidden}
              placeholder="ANSWER…"
              aria-label="Your answer"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              className="min-w-0 flex-1 bg-transparent text-xl uppercase text-ink placeholder:text-mist/40 sm:text-3xl"
            />
          </label>
          <button type="submit" aria-label="Dive — submit answer" disabled={hidden} className="px-btn px-btn-dive font-display flex h-14 shrink-0 items-center gap-2 px-4 text-xs sm:px-6 sm:text-sm">
            DIVE <span aria-hidden>▼</span>
          </button>
        </motion.form>
        <div className="mt-2 text-center text-base text-mist/80">ENTER to dive · one answer per question</div>
      </div>
    </>
  )
}
