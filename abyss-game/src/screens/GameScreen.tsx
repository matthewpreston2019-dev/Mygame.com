import { AnimatePresence, motion } from 'framer-motion'
import { Heart, Play, Volume2, VolumeX, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Countdown } from '../components/game/Countdown'
import { QuestionView } from '../components/game/QuestionView'
import { RevealPanel } from '../components/game/RevealPanel'
import { Button, Modal } from '../components/ui'
import { SCORING, TIER_META } from '../engine/scoring'
import { depthForIndex, zoneForDepth } from '../lib/progression'
import { useGame } from '../state/game'
import { useProfile } from '../state/profile'
import { useUi } from '../state/ui'
import ResultsScreen from './ResultsScreen'

export default function GameScreen() {
  const go = useUi((s) => s.go)
  const g = useGame()
  const sound = useProfile((s) => s.settings.sound)
  const updateSettings = useProfile((s) => s.updateSettings)
  const [confirmExit, setConfirmExit] = useState(false)

  useEffect(() => {
    if (g.phase === 'idle') go('menu')
  }, [g.phase, go])

  // Ask before closing the tab mid-run.
  useEffect(() => {
    if (g.phase === 'idle' || g.phase === 'over') return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [g.phase])

  const onNext = useCallback(() => useGame.getState().next(), [])

  if (g.phase === 'idle') return <div />
  if (g.phase === 'over') return <ResultsScreen />

  const q = g.questions[g.index]
  const score = g.results.reduce((a, r) => a + r.points, 0)
  const depth = depthForIndex(g.index, g.mode)
  const isEndless = g.mode === 'endless'
  const canPause = g.mode !== 'daily'
  const lastResult = g.results[g.results.length - 1]
  const isLast = isEndless ? g.lives <= 0 || g.index + 1 >= g.questions.length : g.index + 1 >= g.questions.length

  const openExit = () => {
    if (canPause) g.pause()
    setConfirmExit(true)
  }
  const closeExit = () => {
    setConfirmExit(false)
    useGame.getState().resume()
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-10 pt-4 sm:px-6 sm:pt-6">
      {/* HUD */}
      <div className="flex items-center gap-3">
        <button onClick={openExit} aria-label="Exit game" className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-mist transition hover:bg-white/10 hover:text-ink">
          <X size={20} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          {isEndless ? (
            <div className="flex items-center gap-1.5" aria-label={`${g.lives} lives left`}>
              {Array.from({ length: SCORING.endlessLives }, (_, i) => (
                <motion.span key={i} animate={{ scale: i < g.lives ? 1 : 0.8, opacity: i < g.lives ? 1 : 0.25 }}>
                  <Heart size={18} className={i < g.lives ? 'fill-rose-400 text-rose-400' : 'text-mist'} />
                </motion.span>
              ))}
              <span className="ml-2 text-sm text-mist">#{g.index + 1}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5" aria-label={`Question ${g.index + 1} of ${g.questions.length}`}>
              {g.questions.map((qq, i) => {
                const r = g.results[i]
                const current = i === g.index
                const bg = r ? (r.answer ? TIER_META[r.answer.tier].color : 'rgba(244,63,94,0.7)') : current ? 'var(--accent)' : 'rgba(255,255,255,0.14)'
                return (
                  <motion.span
                    key={qq.id}
                    layout
                    className="h-2 rounded-full"
                    style={{ background: bg, width: current ? 28 : 14, boxShadow: current ? '0 0 12px var(--accent)' : undefined }}
                  />
                )
              })}
            </div>
          )}
          <div className="mt-1.5 text-[11px] uppercase tracking-[0.2em] text-mist">
            {depth.toLocaleString()} m · {zoneForDepth(depth)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => updateSettings({ sound: !sound })}
            aria-label={sound ? 'Mute sound' : 'Unmute sound'}
            className="glass hidden h-11 w-11 items-center justify-center rounded-2xl text-mist transition hover:bg-white/10 hover:text-ink sm:flex"
          >
            {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <div className="glass flex h-11 min-w-[72px] flex-col items-center justify-center rounded-2xl px-3">
            <motion.span key={score} initial={{ scale: 1.3, color: 'var(--accent)' }} animate={{ scale: 1, color: '#e6f7ff' }} className="text-base font-semibold leading-none tabular-nums">
              {score}
            </motion.span>
            <span className="text-[9px] uppercase tracking-[0.18em] text-mist">score</span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-center py-6 sm:py-10">
        <AnimatePresence mode="wait">
          {g.phase === 'intro' && q && (
            <Countdown
              key={`intro-${g.index}`}
              first={g.index === 0}
              questionNumber={g.index + 1}
              totalLabel={isEndless ? '' : ` of ${g.questions.length}`}
              depth={depth}
              category={q.category}
              onDone={() => useGame.getState().beginQuestion()}
            />
          )}
          {g.phase === 'question' && q && <QuestionView key={`q-${q.id}`} question={q} canPause={canPause} />}
          {g.phase === 'reveal' && q && lastResult && (
            <RevealPanel key={`r-${q.id}`} question={q} result={lastResult} isLast={isLast} livesLeft={isEndless ? g.lives : undefined} onNext={onNext} />
          )}
        </AnimatePresence>
      </div>

      {/* Pause overlay */}
      <AnimatePresence>
        {g.paused !== null && !confirmExit && (
          <motion.div className="fixed inset-0 z-40 flex items-center justify-center bg-[#01040b]/70 p-6 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="text-center">
              <div className="font-display text-4xl italic">Holding breath…</div>
              <p className="mt-2 text-mist">The question is hidden while paused.</p>
              <div className="mt-6 flex justify-center gap-3">
                <Button variant="primary" size="lg" icon={<Play size={18} fill="currentColor" />} onClick={() => g.resume()} autoFocus>
                  Resume
                </Button>
                <Button size="lg" onClick={() => setConfirmExit(true)}>
                  Quit
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={confirmExit} onClose={closeExit} title="Surface early?">
        <p className="text-mist">
          {g.mode === 'daily'
            ? 'Leaving now will lock in today’s daily challenge with your current score. You can’t retry it until tomorrow.'
            : 'Your progress in this dive will be lost. Personal stats only count finished runs.'}
        </p>
        <div className="mt-6 flex gap-3">
          <Button className="flex-1" onClick={closeExit} autoFocus>
            Keep diving
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => {
              setConfirmExit(false)
              const wasDaily = g.mode === 'daily'
              g.abandon()
              if (!wasDaily || useGame.getState().phase === 'idle') go('menu')
            }}
          >
            Surface
          </Button>
        </div>
      </Modal>
    </div>
  )
}
