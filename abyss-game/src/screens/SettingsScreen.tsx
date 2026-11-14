import { CloudDownload, CloudUpload, Download, Trash2, Upload, Volume2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button, Modal, Panel, ScreenShell, Toast, Toggle } from '../components/ui'
import { QUESTIONS } from '../engine/questionBank'
import { play } from '../lib/audio'
import { cloudLoad, cloudSave, onlineConfigured } from '../lib/online'
import { stripActions, useProfile } from '../state/profile'
import type { ProfileData } from '../state/profileTypes'
import { useUi } from '../state/ui'

export default function SettingsScreen() {
  const go = useUi((s) => s.go)
  const settings = useProfile((s) => s.settings)
  const update = useProfile((s) => s.updateSettings)
  const name = useProfile((s) => s.name)
  const setName = useProfile((s) => s.setName)
  const reset = useProfile((s) => s.resetProgress)
  const importProfile = useProfile((s) => s.importProfile)
  const [confirmReset, setConfirmReset] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const fileRef = useRef<HTMLInputElement>(null)

  const exportData = () => {
    const blob = new Blob([JSON.stringify(stripActions(useProfile.getState()), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `abyss-progress-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    setToast('Progress exported')
  }

  const importData = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as ProfileData
      if (typeof data !== 'object' || typeof data.xp !== 'number' || !Array.isArray(data.history)) throw new Error('bad file')
      importProfile(data)
      setDraftName(data.name)
      setToast('Progress imported')
    } catch {
      setToast('That file isn’t a valid ABYSS save')
    }
  }

  const cloud = async (dir: 'up' | 'down') => {
    setBusy(true)
    try {
      if (dir === 'up') {
        await cloudSave(stripActions(useProfile.getState()))
        setToast('Progress backed up to the cloud')
      } else {
        const data = await cloudLoad()
        if (data) {
          importProfile(data)
          setDraftName(data.name)
          setToast('Cloud progress restored')
        } else setToast('No cloud save found for this device yet')
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Cloud sync failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScreenShell title="Settings" subtitle="Sound, comfort and your data" onBack={() => go('menu')}>
      <div className="space-y-4">
        <Panel className="p-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-mist">Diver</h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setName(draftName)
              setToast('Name saved')
            }}
          >
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value.slice(0, 20))}
              maxLength={20}
              aria-label="Diver name"
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5"
            />
            <Button type="submit" disabled={!draftName.trim() || draftName.trim() === name}>
              Save
            </Button>
          </form>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-mist">Sound</h2>
          <Toggle checked={settings.sound} onChange={(v) => update({ sound: v })} label="Sound effects" description="Submissions, reveals, rare finds and results" />
          <div className={`flex items-center gap-4 py-3 ${settings.sound ? '' : 'pointer-events-none opacity-40'}`}>
            <Volume2 size={18} className="shrink-0 text-mist" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              aria-label="Volume"
              style={{ ['--fill' as string]: `${settings.volume * 100}%` }}
              onChange={(e) => update({ volume: Number(e.target.value) })}
              onPointerUp={() => play('correct')}
            />
            <span className="w-10 text-right text-sm tabular-nums text-mist">{Math.round(settings.volume * 100)}</span>
          </div>
          <Toggle checked={settings.showTimerTicks} onChange={(v) => update({ showTimerTicks: v })} label="Countdown ticks" description="Soft ticks in the last 10 seconds" />
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-mist">Comfort</h2>
          <Toggle checked={settings.reducedMotion} onChange={(v) => update({ reducedMotion: v })} label="Reduce motion" description="Calmer transitions and a still ocean" />
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-mist">Your data</h2>
          <p className="mb-4 text-sm text-mist">Progress is saved automatically on this device. Export a backup or move it to another browser.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button icon={<Download size={16} />} onClick={exportData}>
              Export
            </Button>
            <Button icon={<Upload size={16} />} onClick={() => fileRef.current?.click()}>
              Import
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importData(f)
                e.target.value = ''
              }}
            />
          </div>
          <div className="mt-4 border-t border-white/5 pt-4">
            <div className="text-sm font-medium">Cloud save</div>
            {onlineConfigured ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button icon={<CloudUpload size={16} />} disabled={busy} onClick={() => void cloud('up')}>
                  Back up
                </Button>
                <Button icon={<CloudDownload size={16} />} disabled={busy} onClick={() => void cloud('down')}>
                  Restore
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-sm text-mist">Not configured in this build. Everything works offline; cloud backup becomes available when an online backend is connected.</p>
            )}
          </div>
          <Button variant="ghost" className="mt-4 w-full !text-rose-300 hover:!bg-rose-500/10" icon={<Trash2 size={16} />} onClick={() => setConfirmReset(true)}>
            Reset all progress
          </Button>
        </Panel>

        <p className="text-center text-xs text-mist/70">ABYSS v1.0 · {QUESTIONS.length} questions · Works fully offline</p>
      </div>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset all progress?">
        <p className="text-mist">This permanently erases your level, statistics, achievements, history, daily results and local leaderboard on this device.</p>
        <div className="mt-6 flex gap-3">
          <Button className="flex-1" onClick={() => setConfirmReset(false)} autoFocus>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => {
              reset()
              setConfirmReset(false)
              setToast('Progress reset')
            }}
          >
            Reset
          </Button>
        </div>
      </Modal>
      <Toast message={toast} onDone={() => setToast(null)} />
    </ScreenShell>
  )
}
