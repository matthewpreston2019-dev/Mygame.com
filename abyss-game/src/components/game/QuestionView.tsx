import { motion } from 'framer-motion'
import { CornerDownLeft, Pause } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CATEGORY_META } from '../../engine/questionBank'
import { SCORING } from '../../engine/scoring'
import type { Question } from '../../engine/types'
import { play } from '../../lib/audio'
import { useGame } from '../../state/game'
import { useProfile } from '../../state/profile'
import { TimerRing } from './TimerRing'

const TOTAL = SCORING.secondsPerQuestion * 1000

export function QuestionView({ question, canPause }: { question: Question; canPause: boolean }) {
  const deadline = useGame((s) => s.deadline)
  const paused = useGame((s) => s.paused)
  const submit = useGame((s) => s.submit)
  const pause = useGame((s) => s.pause)
  const ticks = useProfile((s) => s.settings.showTimerTicks)
  const [value, setValue] = useState('')
  const [remaining, setRemaining] = useState(TOTAL)
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
      inputRef.current?.focus()
      return
    }
    play('submit')
    submit(value)
  }

  const meta = CATEGORY_META[question.category]
  return (
    <motion.div initial={{ opacity: 0, y: 30, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -16, filter: 'blur(6px)', transition: { duration: 0.2 } }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-mist">
            <span className="rounded-full bg-white/5 px-3 py-1">
              {meta.icon} {meta.label}
            </span>
            <span className="rounded-full bg-white/5 px-3 py-1 capitalize">{question.difficulty}</span>
          </div>
          <div className="mt-2 text-xs text-mist">{question.answers.length} accepted answers · rarer scores higher</div>
        </div>
        <TimerRing remainingMs={remaining} totalMs={TOTAL} paused={paused !== null} />
      </div>

      <h2 className={`mt-6 font-display text-3xl font-medium leading-tight tracking-tight sm:text-[2.6rem] sm:leading-[1.15] ${paused !== null ? 'blur-md' : ''}`}>{question.text}</h2>

      <form onSubmit={onSubmit} className="mt-8">
        <div className="glass glow-ring flex items-center gap-2 rounded-3xl p-2 pl-5 transition focus-within:shadow-[0_0_0_1px_var(--accent),0_0_40px_-6px_rgb(var(--glow)/0.8)]">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, 80))}
            disabled={paused !== null}
            placeholder="Type a rare answer…"
            aria-label="Your answer"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            className="min-w-0 flex-1 bg-transparent py-3 text-lg text-ink placeholder:text-mist/50 sm:text-xl"
          />
          <button
            type="submit"
            aria-label="Submit answer"
            disabled={!value.trim() || paused !== null}
            className="flex h-12 items-center gap-2 rounded-2xl bg-gradient-to-br from-accent to-accent-2 px-5 font-semibold text-slate-950 transition hover:brightness-110 active:scale-95 disabled:opacity-35"
          >
            <span className="hidden sm:inline">Submit</span>
            <CornerDownLeft size={18} />
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between px-2 text-xs text-mist">
          <span>One answer only — make it count.</span>
          {canPause && (
            <button type="button" onClick={pause} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/5 hover:text-ink">
              <Pause size={12} /> Pause
            </button>
          )}
        </div>
      </form>
    </motion.div>
  )
}
