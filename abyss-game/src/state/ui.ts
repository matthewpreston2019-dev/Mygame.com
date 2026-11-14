import { create } from 'zustand'

export type Screen = 'menu' | 'game' | 'daily' | 'leaderboard' | 'profile' | 'settings'

interface UiState {
  screen: Screen
  go: (screen: Screen) => void
}

export const useUi = create<UiState>()((set) => ({
  screen: 'menu',
  go: (screen) => {
    set({ screen })
    window.scrollTo({ top: 0 })
  },
}))
