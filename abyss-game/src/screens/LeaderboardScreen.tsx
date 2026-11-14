import { motion } from 'framer-motion'
import { Cloud, CloudOff, HardDrive, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, ScreenShell, Segmented } from '../components/ui'
import { dateKey } from '../engine/rng'
import type { GameMode } from '../engine/types'
import { fetchOnlineScores, onlineConfigured, type OnlineScore } from '../lib/online'
import { useProfile } from '../state/profile'
import { useUi } from '../state/ui'

type Source = 'local' | 'online'

interface Row {
  key: string
  name: string
  score: number
  detail: string
  mine: boolean
}

export default function LeaderboardScreen() {
  const go = useUi((s) => s.go)
  const local = useProfile((s) => s.leaderboard)
  const myName = useProfile((s) => s.name)
  const [source, setSource] = useState<Source>('local')
  const [mode, setMode] = useState<GameMode>('standard')
  const [online, setOnline] = useState<OnlineScore[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = dateKey()

  const loadOnline = useCallback(async () => {
    if (!onlineConfigured) return
    setLoading(true)
    setError(null)
    try {
      setOnline(await fetchOnlineScores(mode, today))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load online scores')
      setOnline(null)
    } finally {
      setLoading(false)
    }
  }, [mode, today])

  useEffect(() => {
    if (source === 'online') void loadOnline()
  }, [source, loadOnline])

  const rows: Row[] =
    source === 'local'
      ? local
          .filter((e) => e.mode === mode && (mode !== 'daily' || e.dailyKey === today))
          .slice(0, 25)
          .map((e) => ({
            key: e.id,
            name: e.name,
            score: e.score,
            detail: `${e.correct}/${e.total} correct · ${new Date(e.at).toLocaleDateString()}`,
            mine: e.name === myName,
          }))
      : (online ?? []).map((e, i) => ({
          key: `${i}-${e.created_at}`,
          name: e.player_name,
          score: e.score,
          detail: `${e.correct}/${e.total} correct · ${new Date(e.created_at).toLocaleDateString()}`,
          mine: e.player_name === myName,
        }))

  return (
    <ScreenShell title="Leaderboard" subtitle={source === 'local' ? 'Scores achieved on this device' : 'Global scores'} onBack={() => go('menu')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={source}
          onChange={setSource}
          options={[
            { value: 'local', label: 'This device' },
            { value: 'online', label: 'Online' },
          ]}
        />
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'standard', label: 'Dive' },
            { value: 'daily', label: 'Today' },
            { value: 'endless', label: 'Endless' },
          ]}
        />
      </div>

      {source === 'online' && !onlineConfigured ? (
        <div className="glass mt-6 rounded-3xl p-6 text-center">
          <CloudOff className="mx-auto text-mist" size={32} />
          <h2 className="mt-3 text-lg font-semibold">Online leaderboard not connected</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mist">
            This build has no online backend configured, so there are no global scores to show — we never display fake ones. Your scores are saved on this
            device under <b className="text-ink">This device</b>.
          </p>
          <p className="mx-auto mt-3 max-w-md text-xs text-mist/80">
            Developers: set <code className="text-accent">VITE_SUPABASE_URL</code> and <code className="text-accent">VITE_SUPABASE_ANON_KEY</code> and run{' '}
            <code className="text-accent">supabase/schema.sql</code> to enable it.
          </p>
          <Button className="mt-5" icon={<HardDrive size={16} />} onClick={() => setSource('local')}>
            View device scores
          </Button>
        </div>
      ) : (
        <div className="mt-6">
          {source === 'online' && (
            <div className="mb-3 flex items-center justify-between text-sm text-mist">
              <span className="flex items-center gap-2">
                <Cloud size={14} className="text-accent" /> Live from the online leaderboard
              </span>
              <Button size="sm" variant="ghost" icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />} onClick={() => void loadOnline()}>
                Refresh
              </Button>
            </div>
          )}
          {error && <div className="mb-3 rounded-2xl bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
          {loading && !online ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="shimmer h-16 rounded-2xl bg-white/5" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="glass rounded-3xl p-8 text-center text-mist">
              <div className="text-4xl">🫧</div>
              <p className="mt-3">No scores yet{mode === 'daily' ? ' for today’s challenge' : ''}. Finish a dive to claim the top spot.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((r, i) => (
                <motion.div
                  key={r.key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={`glass flex items-center gap-4 rounded-2xl p-3.5 ${r.mine ? 'ring-1 ring-accent/50' : ''}`}
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                      i === 0 ? 'bg-amber-300/20 text-amber-200' : i === 1 ? 'bg-slate-300/20 text-slate-200' : i === 2 ? 'bg-orange-400/20 text-orange-200' : 'bg-white/5 text-mist'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {r.name}
                      {r.mine && <span className="ml-2 text-xs font-medium text-accent">you</span>}
                    </span>
                    <span className="block truncate text-xs text-mist">{r.detail}</span>
                  </span>
                  <span className="text-xl font-semibold tabular-nums">{r.score}</span>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}
    </ScreenShell>
  )
}
