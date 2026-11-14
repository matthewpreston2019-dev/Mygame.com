import { depthForPoints, pointsForShare, SCORING, TIER_META } from '../engine/scoring'
import type { RarityTier } from '../engine/types'
import { Button, Modal, RarityBadge } from './ui'

const EXAMPLES: { answer: string; share: number; tier: RarityTier }[] = [
  { answer: 'Brazil', share: 0.4, tier: 'common' },
  { answer: 'Chile', share: 0.1, tier: 'uncommon' },
  { answer: 'Paraguay', share: 0.04, tier: 'rare' },
  { answer: 'Guyana', share: 0.015, tier: 'epic' },
  { answer: 'Suriname', share: 0.004, tier: 'legendary' },
]

export function HowToPlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="How to dive">
      <ol className="space-y-2 text-xl leading-tight text-ink/90">
        <li>
          <span className="font-semibold text-accent">1.</span> Each run has <b>{SCORING.questionsPerRun} questions</b> with many correct answers, like
          “Name a country in South America”.
        </li>
        <li>
          <span className="font-semibold text-accent">2.</span> You get <b>one answer</b> and <b>{SCORING.secondsPerQuestion} seconds</b>. Press Enter to submit.
        </li>
        <li>
          <span className="font-semibold text-accent">3.</span> Correct answers score by <b>rarity</b>: the fewer people who’d think of it, the more it’s worth.
          Wrong answers score 0.
        </li>
        <li>
          <span className="font-semibold text-accent">4.</span> Every point sinks your diver <b>{SCORING.depthPerPoint} m</b>. Rare answers plunge you deep; reach the trench floor
          at {depthForPoints(SCORING.maxPoints * SCORING.questionsPerRun).toLocaleString('en-US')} m.
        </li>
      </ol>
      <div className="px-input mt-5 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 bg-white/5 px-3 py-2 text-base uppercase text-mist">
          <span>Example</span>
          <span>Rarity</span>
          <span className="text-right">Pts</span>
          <span className="text-right">Depth</span>
        </div>
        {EXAMPLES.map((e) => (
          <div key={e.answer} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-t border-white/5 px-3 py-1.5 text-xl">
            <span>{e.answer}</span>
            <RarityBadge tier={e.tier} size="sm" />
            <span className="w-8 text-right font-semibold tabular-nums" style={{ color: TIER_META[e.tier].color }}>
              {pointsForShare(e.share)}
            </span>
            <span className="w-14 text-right tabular-nums text-accent">{depthForPoints(pointsForShare(e.share))}m</span>
          </div>
        ))}
      </div>
      <details className="mt-4 text-lg leading-tight text-mist">
        <summary className="cursor-pointer select-none text-ink/80">The exact formula</summary>
        <p className="mt-2">
          Each answer has an estimated share <i>s</i> of players who give it, from a curated popularity ranking. Points ={' '}
          <code className="text-accent">
            {SCORING.minPoints} + {SCORING.maxPoints - SCORING.minPoints} × min(1, log(1/s) / log({Math.round(1 / SCORING.legendaryShare)}))
          </code>
          . Every halving of popularity adds the same number of points, and anything rarer than {SCORING.legendaryShare * 100}% scores the full{' '}
          {SCORING.maxPoints}. Small typos on longer words are forgiven. Shares are curated estimates, not live player data.
        </p>
      </details>
      <Button variant="primary" className="mt-6 w-full" onClick={onClose}>
        Got it — dive!
      </Button>
    </Modal>
  )
}
