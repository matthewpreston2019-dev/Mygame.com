import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { useEffect } from 'react'
import { PixelOcean } from './components/ocean/PixelOcean'
import { depthForPoints } from './engine/scoring'
import { configureAudio } from './lib/audio'
import DailyScreen from './screens/DailyScreen'
import GameScreen from './screens/GameScreen'
import LeaderboardScreen from './screens/LeaderboardScreen'
import MainMenu from './screens/MainMenu'
import ProfileScreen from './screens/ProfileScreen'
import SettingsScreen from './screens/SettingsScreen'
import { useGame } from './state/game'
import { useProfile } from './state/profile'
import { useUi, type Screen } from './state/ui'

const SCREENS: Record<Screen, () => React.JSX.Element> = {
  menu: MainMenu,
  game: GameScreen,
  daily: DailyScreen,
  leaderboard: LeaderboardScreen,
  profile: ProfileScreen,
  settings: SettingsScreen,
}

/** Where the diver hovers on screens outside a dive. */
const IDLE_DEPTH: Record<Screen, number> = { menu: 0, game: 0, daily: 260, leaderboard: 420, profile: 420, settings: 260 }

export default function App() {
  const screen = useUi((s) => s.screen)
  const settings = useProfile((s) => s.settings)
  const phase = useGame((s) => s.phase)
  const results = useGame((s) => s.results)

  useEffect(() => configureAudio({ enabled: settings.sound, volume: settings.volume }), [settings.sound, settings.volume])
  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion)
  }, [settings.reducedMotion])

  const inGame = screen === 'game' && phase !== 'idle'
  const depth = inGame ? depthForPoints(results.reduce((a, r) => a + r.points, 0)) : IDLE_DEPTH[screen]

  const Current = SCREENS[screen]
  return (
    <MotionConfig reducedMotion={settings.reducedMotion ? 'always' : 'user'}>
      <PixelOcean depth={depth} reducedMotion={settings.reducedMotion} />
      <AnimatePresence mode="wait">
        <motion.main
          key={screen}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: (t: number) => Math.round(t * 3) / 3 }}
          className="relative min-h-dvh"
        >
          <Current />
        </motion.main>
      </AnimatePresence>
      <div className="crt" aria-hidden="true" />
    </MotionConfig>
  )
}
