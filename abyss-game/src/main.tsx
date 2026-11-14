import '@fontsource/press-start-2p/latin-400.css'
import '@fontsource/vt323/latin-400.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Test hook for automated browser QA (development builds only).
if (import.meta.env.DEV) {
  void Promise.all([import('./state/game'), import('./state/profile'), import('./state/ui')]).then(([g, p, u]) => {
    ;(window as unknown as Record<string, unknown>).__abyss = { game: g.useGame, profile: p.useProfile, ui: u.useUi }
  })
}
