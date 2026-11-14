import { motion } from 'framer-motion'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { Button, Modal, ProgressBar, RarityBadge, ScreenShell, Segmented, StatTile } from '../components/ui'
import { CATEGORY_META } from '../engine/questionBank'
import { dailyNumber } from '../engine/rng'
import { depthForPoints, formatShare, TIER_META } from '../engine/scoring'
import { CATEGORIES, type RarityTier } from '../engine/types'
import { ACHIEVEMENTS, dailyStreak } from '../lib/achievements'
import { levelProgress, nextTitle, titleForLevel } from '../lib/progression'
import { useProfile } from '../state/profile'
import { useUi } from '../state/ui'
import { useGame } from '../state/game'

type Tab = 'stats' | 'awards' | 'history'
const TIERS: RarityTier[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']
const MODE_LABEL = { standard: 'Dive', daily: 'Daily', endless: 'Endless' } as const

export default function ProfileScreen() {
  const go = useUi((s) => s.go)
  const p = useProfile()
  const [tab, setTab] = useState<Tab>('stats')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(p.name)

  const prog = levelProgress(p.xp)
  const nt = nextTitle(prog.level)
  const accuracy = p.totalAnswered ? Math.round((p.totalCorrect / p.totalAnswered) * 100) : 0
  const tierTotal = TIERS.reduce((a, t) => a + p.tierCounts[t], 0)

  return (
    <ScreenShell title="Diver profile" subtitle="Statistics, achievements and rewards" onBack={() => go('menu')}>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass relative overflow-hidden rounded-3xl p-5 sm:p-6">
                <div className="relative flex items-center gap-4">
          <div className="font-display flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 bg-accent text-[#04151c]">
            <span className="text-[8px] leading-none">LV</span>
            <span className="text-lg leading-none">{prog.level}</span>
          </div>
          <div className="min-w-0 flex-1">
            <button
              onClick={() => {
                setDraft(p.name)
                setEditing(true)
              }}
              className="group flex max-w-full items-center gap-2 text-left"
            >
              <span className="truncate text-xl font-semibold">{p.name}</span>
              <Pencil size={14} className="shrink-0 text-mist group-hover:text-accent" />
            </button>
            <div className="text-sm text-accent">{titleForLevel(prog.level)}</div>
            <ProgressBar value={prog.pct} className="mt-2" />
            <div className="mt-1 text-xs text-mist">
              {p.xp.toLocaleString()} XP · {(prog.needed - prog.into).toLocaleString()} to level {prog.level + 1}
              {nt && ` · “${nt.title}” at level ${nt.level}`}
            </div>
          </div>
        </div>
      </motion.div>

      <div className="mt-5">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'stats', label: 'Statistics' },
            { value: 'awards', label: 'Rewards' },
            { value: 'history', label: 'History' },
          ]}
        />
      </div>

      {tab === 'stats' && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Games" value={p.gamesPlayed} />
            <StatTile label="Accuracy" value={`${accuracy}%`} hint={`${p.totalCorrect}/${p.totalAnswered} answers`} />
            <StatTile label="Best streak" value={p.bestStreak} hint={`Current: ${p.currentStreak}`} />
            <StatTile label="Daily streak" value={dailyStreak(p.dailies)} />
            <StatTile label="Best dive" value={p.bests.standard} accent />
            <StatTile label="Best daily" value={p.bests.daily} />
            <StatTile label="Deepest dive" value={`${depthForPoints(Math.max(p.bests.standard, p.bests.daily)).toLocaleString('en-US')}m`} />
            <StatTile label="Total points" value={p.totalPoints.toLocaleString()} />
          </div>

          <div className="glass rounded-3xl p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Rarest answer ever</div>
            {p.bestAnswer ? (
              <div className="mt-2 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-xl font-semibold">{p.bestAnswer.text}</div>
                  <div className="truncate text-sm text-mist">{p.bestAnswer.question}</div>
                </div>
                <div className="shrink-0 text-right">
                  <RarityBadge tier={p.bestAnswer.tier} />
                  <div className="mt-1 text-xs text-mist">{formatShare(p.bestAnswer.share)} of divers</div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-mist">Answer a question correctly to record your rarest find.</p>
            )}
          </div>

          <div className="glass rounded-3xl p-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-mist">Rarity of your correct answers</div>
            <div className="flex h-3 overflow-hidden rounded-full bg-white/5">
              {tierTotal > 0 &&
                TIERS.map((t) => (
                  <div key={t} style={{ width: `${(p.tierCounts[t] / tierTotal) * 100}%`, background: TIER_META[t].color }} title={`${TIER_META[t].label}: ${p.tierCounts[t]}`} />
                ))}
            </div>
            <div className="mt-3 grid grid-cols-5 gap-2 text-center">
              {TIERS.map((t) => (
                <div key={t}>
                  <div className="text-lg font-semibold tabular-nums" style={{ color: TIER_META[t].color }}>
                    {p.tierCounts[t]}
                  </div>
                  <div className="truncate text-[10px] uppercase tracking-wider text-mist">{TIER_META[t].label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass rounded-3xl p-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-mist">Categories</div>
            <div className="space-y-3">
              {CATEGORIES.map((c) => {
                const s = p.categoryStats[c]
                const acc = s && s.answered ? s.correct / s.answered : 0
                return (
                  <div key={c} className="flex items-center gap-3">
                    <span className="w-6 text-center">{CATEGORY_META[c].icon}</span>
                    <span className="w-28 shrink-0 truncate text-sm sm:w-36">{CATEGORY_META[c].label}</span>
                    <ProgressBar value={acc} className="flex-1" />
                    <span className="w-24 shrink-0 text-right text-xs tabular-nums text-mist">
                      {s ? `${Math.round(acc * 100)}% · ${s.answered}` : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'awards' && (
        <div className="mt-5 space-y-6">
          <section>
            <h2 className="mb-3 px-1 text-[9px] uppercase text-mist">
              Achievements · {Object.keys(p.achievements).length}/{ACHIEVEMENTS.length}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {ACHIEVEMENTS.map((a) => {
                const at = p.achievements[a.id]
                return (
                  <div key={a.id} className={`glass flex items-center gap-3 rounded-2xl p-3.5 ${at ? '' : 'opacity-50'}`}>
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${at ? 'bg-accent/15' : 'bg-white/5 grayscale'}`}>{a.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{a.name}</span>
                      <span className="block text-xs leading-snug text-mist">{a.description}</span>
                      {at && <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-accent">Unlocked {new Date(at).toLocaleDateString()}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}

      {tab === 'history' && (
        <div className="mt-5 space-y-2">
          {p.history.length === 0 ? (
            <div className="glass rounded-3xl p-8 text-center text-mist">
              <div className="text-4xl">🐚</div>
              <p className="mt-3">No dives logged yet.</p>
              <Button variant="primary" className="mt-4" onClick={() => {
                  if (useGame.getState().start('standard')) go('game')
                }}>
                Start your first dive
              </Button>
            </div>
          ) : (
            p.history.map((h) => (
              <div key={h.id} className="glass flex items-center gap-3 rounded-2xl p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">
                    {h.mode === 'daily' && h.dailyKey ? `Daily #${dailyNumber(h.dailyKey)}` : MODE_LABEL[h.mode]}
                    {!h.completed && <span className="ml-2 text-xs font-normal text-mist">surfaced early</span>}
                  </div>
                  <div className="text-xs text-mist">
                    {new Date(h.endedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {h.correct}/{h.results.length} correct
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {h.results.map((r, i) => (
                      <span key={i} className="h-2.5 w-4 rounded-sm" style={{ background: r.answer ? TIER_META[r.answer.tier].color : 'rgba(255,255,255,0.12)' }} />
                    ))}
                  </div>
                </div>
                <span className="text-right leading-tight"><span className="font-display block text-[10px] text-[#ffd23e]">{h.score}</span><span className="block text-lg text-accent">{depthForPoints(h.score).toLocaleString('en-US')}m</span></span>
              </div>
            ))
          )}
        </div>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title="Diver name">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            p.setName(draft)
            setEditing(false)
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 20))}
            autoFocus
            maxLength={20}
            className="glass w-full rounded-2xl px-4 py-3 text-lg"
            aria-label="Diver name"
          />
          <p className="mt-2 text-xs text-mist">Shown on leaderboards and share cards. Up to 20 characters.</p>
          <Button type="submit" variant="primary" className="mt-5 w-full" disabled={!draft.trim()}>
            Save
          </Button>
        </form>
      </Modal>
    </ScreenShell>
  )
}
