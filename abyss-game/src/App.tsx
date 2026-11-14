import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { useEffect } from 'react'
import { OceanBackground } from './components/OceanBackground'
import { configureAudio } from './lib/audio'
import { applyTheme } from './lib/cosmetics'
import { depthForIndex } from './lib/progression'
import DailyScreen from './screens/DailyScreen'
import GameScreen from './screens/GameScreen'
import LeaderboardScreen from './screens/LeaderboardScreen'
import LobbyScreen from './screens/LobbyScreen'
import MainMenu from './screens/MainMenu'
import ProfileScreen from './screens/ProfileScreen'
import SettingsScreen from './screens/SettingsScreen'
import { useGame } from './state/game'
import { useProfile } from './state/profile'
import { useUi, type Screen } from './state/ui'

const SCREENS: Record<Screen, () => React.JSX.Element> = {
  menu: MainMenu,
  lobby: LobbyScreen,
  game: GameScreen,
  daily: DailyScreen,
  leaderboard: LeaderboardScreen,
  profile: ProfileScreen,
  settings: SettingsScreen,
}

export default function App() {
  const screen = useUi((s) => s.screen)
  const theme = useProfile((s) => s.theme)
  const settings = useProfile((s) => s.settings)
  const phase = useGame((s) => s.phase)
  const index = useGame((s) => s.index)
  const mode = useGame((s) => s.mode)

  useEffect(() => applyTheme(theme), [theme])
  useEffect(() => configureAudio({ enabled: settings.sound, volume: settings.volume }), [settings.sound, settings.volume])
  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion)
  }, [settings.reducedMotion])

  const inGame = screen === 'game' && phase !== 'idle'
  const depth = inGame ? Math.min(1, depthForIndex(phase === 'over' ? 6 : index, mode) / 9000) : screen === 'menu' ? 0.05 : 0.18

  const Current = SCREENS[screen]
  return (
    <MotionConfig reducedMotion={settings.reducedMotion ? 'always' : 'user'}>
      <OceanBackground depth={depth} reducedMotion={settings.reducedMotion} />
      <AnimatePresence mode="wait">
        <motion.main
          key={screen}
          initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="relative min-h-dvh"
        >
          <Current />
        </motion.main>
      </AnimatePresence>
    </MotionConfig>
  )
}
