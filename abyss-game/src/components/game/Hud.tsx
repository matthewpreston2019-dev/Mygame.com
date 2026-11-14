import { Pause, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { TIER_META } from '../../engine/scoring'
import type { Question, RoundResult } from '../../engine/types'
import { zoneForDepth } from '../../lib/progression'
import { useProfile } from '../../state/profile'
import { CountUp } from '../ui'
import { oceanBus } from '../ocean/oceanBus'

/** Depth and zone readouts that tick in sync with the ocean camera. */
export function LiveDepth({ className = '', zoneClassName }: { className?: string; zoneClassName?: string }) {
  const depthRef = useRef<HTMLSpanElement>(null)
  const zoneRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    let shown = -1
    const loop = () => {
      const d = Math.max(0, Math.round(oceanBus.depth))
      if (d !== shown) {
        shown = d
        if (depthRef.current) depthRef.current.textContent = d.toLocaleString('en-US')
        if (zoneRef.current) zoneRef.current.textContent = zoneForDepth(d)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <>
      <span className={className}>
        <span ref={depthRef}>0</span>
        <span className="ml-0.5 text-[0.7em]">M</span>
      </span>
      {zoneClassName && <span ref={zoneRef} className={zoneClassName} />}
    </>
  )
}

export function QuestionPips({ questions, results, index }: { questions: Question[]; results: RoundResult[]; index: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5" aria-label={`Question ${index + 1} of ${questions.length}`}>
      {questions.map((q, i) => {
        const r = results[i]
        const current = i === index && !r
        const color = r ? (r.answer ? TIER_META[r.answer.tier].color : '#ff4f5e') : undefined
        return (
          <span
            key={q.id}
            className={`relative flex h-4 w-4 items-center justify-center font-display text-[7px] sm:h-5 sm:w-5 sm:text-[8px] ${current ? 'blink' : ''}`}
            style={{
              background: color ?? (current ? 'rgba(62,232,224,0.25)' : '#0a1630'),
              boxShadow: `0 0 0 2px ${current ? '#3ee8e0' : color ? '#000' : '#24406b'}`,
              color: r ? '#04101c' : current ? '#3ee8e0' : '#4d6d96',
            }}
          >
            {r ? (r.answer ? '' : '×') : i + 1}
          </span>
        )
      })}
    </div>
  )
}

interface HudProps {
  questions: Question[]
  results: RoundResult[]
  index: number
  score: number
  onExit: () => void
  onPause?: () => void
}

export function Hud({ questions, results, index, score, onExit, onPause }: HudProps) {
  const sound = useProfile((s) => s.settings.sound)
  const updateSettings = useProfile((s) => s.updateSettings)
  const iconBtn = 'px-btn flex h-9 w-9 shrink-0 items-center justify-center text-mist hover:text-ink sm:h-10 sm:w-10'
  return (
    <header className="px-box mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-2.5 py-2 sm:flex-nowrap sm:px-3">
      <button onClick={onExit} aria-label="Exit dive" className={iconBtn}>
        <X size={18} />
      </button>
      <div className="min-w-0">
        <div className="font-display text-[7px] text-mist sm:text-[8px]">DEPTH</div>
        <LiveDepth className="font-display block text-sm leading-tight text-accent px-shadow sm:text-lg" zoneClassName="block truncate text-sm uppercase leading-none text-mist" />
      </div>
      <div className="order-last w-full sm:order-none sm:w-auto sm:flex-1">
        <QuestionPips questions={questions} results={results} index={index} />
      </div>
      <div className="ml-auto text-right sm:ml-0">
        <div className="font-display text-[7px] text-mist sm:text-[8px]">SCORE</div>
        <CountUp value={score} duration={0.8} className="font-display block text-sm leading-tight text-[#ffd23e] px-shadow sm:text-lg" />
      </div>
      <div className="flex gap-2">
        {onPause && (
          <button onClick={onPause} aria-label="Pause" className={iconBtn}>
            <Pause size={16} />
          </button>
        )}
        <button onClick={() => updateSettings({ sound: !sound })} aria-label={sound ? 'Mute sound' : 'Unmute sound'} className={iconBtn}>
          {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
      </div>
    </header>
  )
}
