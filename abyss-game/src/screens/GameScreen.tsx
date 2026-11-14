import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { Countdown } from '../components/game/Countdown'
import { Hud } from '../components/game/Hud'
import { QuestionView } from '../components/game/QuestionView'
import { RevealPanel } from '../components/game/RevealPanel'
import { oceanBus } from '../components/ocean/oceanBus'
import { Button, Modal } from '../components/ui'
import { useGame } from '../state/game'
import { useUi } from '../state/ui'
import ResultsScreen from './ResultsScreen'

export default function GameScreen() {
  const go = useUi((s) => s.go)
  const g = useGame()
  const [confirmExit, setConfirmExit] = useState(false)
  const [shake, setShake] = useState(false)

  useEffect(() => {
    if (g.phase === 'idle') go('menu')
  }, [g.phase, go])

  // Ask before closing the tab mid-run.
  useEffect(() => {
    if (g.phase === 'idle' || g.phase === 'over') return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [g.phase])

  // Rare answers: sparks around the diver, a flash and (for epic+) a screen shake.
  const resultCount = g.results.length
  useEffect(() => {
    const last = useGame.getState().results[resultCount - 1]
    const tier = last?.answer?.tier
    if (!tier || tier === 'common' || tier === 'uncommon') return
    oceanBus.burst(tier)
    if (tier !== 'epic' && tier !== 'legendary') return
    setShake(true)
    const t = setTimeout(() => setShake(false), 500)
    return () => clearTimeout(t)
  }, [resultCount])

  const onNext = useCallback(() => useGame.getState().next(), [])

  if (g.phase === 'idle') return <div />
  if (g.phase === 'over') return <ResultsScreen />

  const q = g.questions[g.index]
  const score = g.results.reduce((a, r) => a + r.points, 0)
  const canPause = g.mode !== 'daily'
  const lastResult = g.results[g.results.length - 1]
  const isLast = g.mode === 'endless' ? g.lives <= 0 : g.index + 1 >= g.questions.length
  const total = g.mode === 'endless' ? g.index + 1 : g.questions.length

  const openExit = () => {
    if (canPause) g.pause()
    setConfirmExit(true)
  }
  const closeExit = () => {
    setConfirmExit(false)
    useGame.getState().resume()
  }

  return (
    <div className={`flex min-h-dvh w-full flex-col px-3 pt-3 sm:px-6 sm:pt-5 ${shake ? 'screen-shake' : ''}`}>
      <Hud questions={g.questions} results={g.results} index={g.index} score={score} onExit={openExit} onPause={canPause && g.phase === 'question' ? g.pause : undefined} />

      {/* The diver swims in this gap; the canvas reads its position. */}
      <div id="player-anchor" className="min-h-[88px] flex-1 sm:min-h-[120px]" />

      <div className="flex flex-col pb-1">
        <AnimatePresence mode="wait">
          {g.phase === 'intro' && q && (
            <Countdown key={`intro-${g.index}`} first={g.index === 0} questionNumber={g.index + 1} total={total} category={q.category} onDone={() => useGame.getState().beginQuestion()} />
          )}
          {g.phase === 'question' && q && <QuestionView key={`q-${q.id}`} question={q} number={g.index + 1} total={total} />}
          {g.phase === 'reveal' && q && lastResult && <RevealPanel key={`r-${q.id}`} question={q} result={lastResult} isLast={isLast} onNext={onNext} />}
        </AnimatePresence>
        {g.phase === 'intro' && <div className="h-[22vh]" />}
      </div>

      {/* Pause overlay */}
      <AnimatePresence>
        {g.paused !== null && !confirmExit && (
          <motion.div className="fixed inset-0 z-40 flex items-center justify-center bg-[#01040b]/80 p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="px-box px-box-hi p-6 text-center">
              <div className="font-display blink text-xl text-accent">PAUSED</div>
              <p className="mt-3 text-xl text-mist">The question is hidden while paused.</p>
              <div className="mt-5 flex justify-center gap-3">
                <Button variant="primary" size="lg" onClick={() => g.resume()} autoFocus>
                  ▶ Resume
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
        <p className="text-xl text-mist">
          {g.mode === 'daily'
            ? 'Leaving now locks in today’s daily dive with your current score. You can’t retry until tomorrow.'
            : 'This dive will be lost. Only finished dives count toward your stats.'}
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
