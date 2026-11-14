import type { RarityTier } from '../../engine/types'

/**
 * Shared, non-React state between the ocean canvas and the HUD.
 * The canvas writes the animated camera depth every frame; HUD readouts poll
 * it with requestAnimationFrame so the depth counter ticks in sync with the
 * descent without re-rendering React 60 times a second.
 */
export const oceanBus = {
  /** Animated camera depth in metres. */
  depth: 0,
  /** True while a descent tween is running. */
  descending: false,
  burstId: 0,
  burstTier: null as RarityTier | null,
  /** Trigger a celebration burst around the player. */
  burst(tier: RarityTier) {
    this.burstId++
    this.burstTier = tier
  },
}
