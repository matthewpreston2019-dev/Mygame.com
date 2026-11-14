import { pointsForShare, SCORING, TIER_META } from '../engine/scoring'
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
      <ol className="space-y-3 text-[15px] leading-relaxed text-ink/90">
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
      </ol>
      <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 bg-white/5 px-4 py-2 text-[11px] uppercase tracking-[0.14em] text-mist">
          <span>Illustrative answer</span>
          <span>Rarity</span>
          <span className="text-right">Pts</span>
        </div>
        {EXAMPLES.map((e) => (
          <div key={e.answer} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-t border-white/5 px-4 py-2.5 text-sm">
            <span>{e.answer}</span>
            <RarityBadge tier={e.tier} size="sm" />
            <span className="w-8 text-right font-semibold tabular-nums" style={{ color: TIER_META[e.tier].color }}>
              {pointsForShare(e.share)}
            </span>
          </div>
        ))}
      </div>
      <details className="mt-4 text-sm text-mist">
        <summary className="cursor-pointer select-none text-ink/80">The exact formula</summary>
        <p className="mt-2 leading-relaxed">
          Each answer has an estimated share <i>s</i> of players who give it, from a curated popularity ranking. Points ={' '}
          <code className="text-accent">
            {SCORING.minPoints} + {SCORING.maxPoints - SCORING.minPoints} × min(1, log(1/s) / log({Math.round(1 / SCORING.legendaryShare)}))
          </code>
          . Every halving of popularity adds the same number of points, and anything rarer than {SCORING.legendaryShare * 100}% scores the full{' '}
          {SCORING.maxPoints}. Small typos on longer words are forgiven.
        </p>
      </details>
      <Button variant="primary" className="mt-6 w-full" onClick={onClose}>
        Got it — let’s dive
      </Button>
    </Modal>
  )
}
