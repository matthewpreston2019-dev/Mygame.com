import { motion } from 'framer-motion'
import { useMemo } from 'react'
import { TIER_META } from '../../engine/scoring'
import type { RarityTier } from '../../engine/types'

/** Bubble burst for rare finds; a fuller bioluminescent bloom for legendary ones. */
export function Celebration({ tier }: { tier: RarityTier }) {
  const big = tier === 'legendary'
  const count = big ? 46 : tier === 'epic' ? 30 : 20
  const color = TIER_META[tier].color
  const parts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4
        const dist = (big ? 220 : 150) + Math.random() * (big ? 220 : 120)
        return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist - 40, s: 4 + Math.random() * (big ? 10 : 7), d: Math.random() * 0.15, t: 1.1 + Math.random() * 0.6 }
      }),
    [count, big],
  )
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center overflow-hidden">
      {big && (
        <motion.div
          className="absolute inset-0"
          style={{ background: `radial-gradient(circle at center, ${color}55, transparent 60%)` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 1.6 }}
        />
      )}
      <motion.div
        className="absolute rounded-full border-2"
        style={{ borderColor: color, width: 40, height: 40 }}
        initial={{ scale: 0, opacity: 0.9 }}
        animate={{ scale: big ? 22 : 12, opacity: 0 }}
        transition={{ duration: big ? 1.4 : 1, ease: 'easeOut' }}
      />
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{ width: p.s, height: p.s, background: i % 3 === 0 ? '#fff' : color, boxShadow: `0 0 ${p.s * 2}px ${color}` }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 1 }}
          transition={{ duration: p.t, delay: p.d, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
      {big && (
        <motion.div
          className="absolute top-[18%] font-display text-4xl font-semibold italic sm:text-6xl"
          style={{ color, textShadow: `0 0 30px ${color}` }}
          initial={{ opacity: 0, y: 20, letterSpacing: '0.5em' }}
          animate={{ opacity: [0, 1, 1, 0], y: [20, 0, 0, -10], letterSpacing: ['0.5em', '0.12em', '0.12em', '0.12em'] }}
          transition={{ duration: 2.4, times: [0, 0.25, 0.75, 1] }}
        >
          Legendary!
        </motion.div>
      )}
    </div>
  )
}
