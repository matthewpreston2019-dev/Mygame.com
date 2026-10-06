import { useEffect, useState } from 'react';
import { Bot, Brain, Database, Pencil, Plus, Settings2, Trash2, User, UserCog } from 'lucide-react';
import { ALL_TOOLS, MODE_ORDER, MODES } from '@shared/modes';
import type { CustomModeDef, ModeId, ToolName } from '@shared/types';
import { data } from '@/data/store';
import type { Settings } from '@/data/types';
import { useApp } from '@/state/app';
import { REPLY_LANGUAGES, UI_LANGUAGES, useT, type TKey } from '@/i18n';
import { voices, ttsSupported } from '@/lib/voice';
import { cn, downloadText, uid } from '@/lib/utils';
import { Dialog } from '@/components/ui/Dialog';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Field';

type Tab = 'general' | 'personalization' | 'memory' | 'modes' | 'data' | 'account';
const TABS: { id: Tab; label: TKey; icon: typeof User }[] = [
  { id: 'general', label: 'general', icon: Settings2 },
  { id: 'personalization', label: 'personalization', icon: UserCog },
  { id: 'memory', label: 'memory', icon: Brain },
  { id: 'modes', label: 'modes', icon: Bot },
  { id: 'data', label: 'dataPrivacy', icon: Database },
  { id: 'account', label: 'account', icon: User },
];

const Section = ({ title, children, desc }: { title: string; desc?: string; children: React.ReactNode }) => (
  <section className="space-y-3">
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
    </div>
    {children}
  </section>
);

function GeneralTab() {
  const t = useT();
  const s = useApp((x) => x.settings);
  const update = useApp((x) => x.updateSettings);
  const custom = useApp((x) => x.modes);
  const [vs, setVs] = useState<SpeechSynthesisVoice[]>(voices());
  useEffect(() => {
    if (!ttsSupported()) return;
    const h = () => setVs(voices());
    speechSynthesis.addEventListener('voiceschanged', h);
    return () => speechSynthesis.removeEventListener('voiceschanged', h);
  }, []);
  return (
    <div className="space-y-7">
      <Section title={t('appearance')}>
        <div className="grid grid-cols-3 gap-2">
          {(['system', 'light', 'dark'] as const).map((th) => (
            <button
              key={th}
              onClick={() => update({ theme: th })}
              className={cn('rounded-xl border px-3 py-2.5 text-sm transition-colors', s.theme === th ? 'border-accent bg-accent/10 font-medium' : 'border-line hover:bg-hover')}
            >
              {t(th)}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Language" desc="You can always ask in any language, e.g. “Réponds-moi en français”.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('interfaceLanguage')}>
            <Select value={s.uiLanguage} onChange={(e) => update({ uiLanguage: e.target.value })}>
              <option value="auto">Auto ({navigator.language})</option>
              {UI_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('replyLanguage')}>
            <Select value={s.replyLanguage} onChange={(e) => update({ replyLanguage: e.target.value })}>
              <option value="auto">{t('autoDetect')}</option>
              {REPLY_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>
      <Section title="Chat">
        <Field label="Default mode for new chats">
          <Select value={s.defaultMode} onChange={(e) => update({ defaultMode: e.target.value as ModeId })}>
            <option value="auto">Auto</option>
            {MODE_ORDER.map((m) => (
              <option key={m} value={m}>
                {MODES[m].label}
              </option>
            ))}
            {custom.map((m) => (
              <option key={m.id} value={`custom:${m.id}`}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Switch checked={s.enterToSend} onChange={(v) => update({ enterToSend: v })} label="Enter sends the message" description="When off, use Ctrl/⌘ + Enter to send." />
        <Switch
          checked={s.autoApproveCode}
          onChange={(v) => update({ autoApproveCode: v })}
          label="Run AI code without asking"
          description="Code always runs isolated in a browser sandbox. When off, you approve each run."
        />
      </Section>
      {ttsSupported() && (
        <Section title="Voice" desc="Uses your browser's built-in speech engine (free).">
          <Switch checked={s.voice.autoSpeak} onChange={(v) => update({ voice: { ...s.voice, autoSpeak: v } })} label="Read answers aloud automatically" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Voice">
              <Select value={s.voice.voiceURI ?? ''} onChange={(e) => update({ voice: { ...s.voice, voiceURI: e.target.value || undefined } })}>
                <option value="">Default</option>
                {vs.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Speed · ${s.voice.rate.toFixed(1)}×`}>
              <input type="range" min={0.6} max={1.8} step={0.1} value={s.voice.rate} onChange={(e) => update({ voice: { ...s.voice, rate: Number(e.target.value) } })} className="mt-3 w-full accent-[var(--accent)]" />
            </Field>
          </div>
        </Section>
      )}
    </div>
  );
}

function PersonalizationTab() {
  const t = useT();
  const s = useApp((x) => x.settings);
  const update = useApp((x) => x.updateSettings);
  const ci = s.instructions;
  const set = (patch: Partial<Settings['instructions']>) => update({ instructions: { ...ci, ...patch } });
  return (
    <div className="space-y-5">
      <Switch checked={ci.enabled} onChange={(v) => set({ enabled: v })} label={t('customInstructions')} description="Applied to every conversation when enabled." />
      <div className={cn('grid gap-4 sm:grid-cols-2', !ci.enabled && 'pointer-events-none opacity-50')}>
        <Field label="Your name">
          <Input value={ci.name ?? ''} onChange={(e) => set({ name: e.target.value })} maxLength={100} placeholder="e.g. Alex" />
        </Field>
        <Field label="Preferred language">
          <Select value={ci.language ?? 'auto'} onChange={(e) => set({ language: e.target.value })}>
            <option value="auto">{t('autoDetect')}</option>
            {REPLY_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Response style">
          <Select value={ci.responseStyle ?? ''} onChange={(e) => set({ responseStyle: e.target.value })}>
            <option value="">Default</option>
            <option value="Concise and to the point">Concise</option>
            <option value="Detailed and thorough with examples">Detailed</option>
            <option value="Friendly and conversational">Conversational</option>
            <option value="Formal and professional">Formal</option>
            <option value="Bullet points and structured summaries">Structured</option>
          </Select>
        </Field>
        <Field label="Technical level">
          <Select value={ci.technicalLevel ?? ''} onChange={(e) => set({ technicalLevel: e.target.value })}>
            <option value="">Default</option>
            <option value="Beginner — avoid jargon, explain basics">Beginner</option>
            <option value="Intermediate">Intermediate</option>
            <option value="Expert — skip basics, be precise">Expert</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Personality">
            <Input value={ci.personality ?? ''} onChange={(e) => set({ personality: e.target.value })} maxLength={1000} placeholder="e.g. Warm, witty, encouraging" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="What should the AI know about you?">
            <Textarea value={ci.about ?? ''} onChange={(e) => set({ about: e.target.value })} maxLength={3000} placeholder="Your work, interests, goals, location, tools you use…" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="What should the AI avoid?">
            <Textarea value={ci.avoid ?? ''} onChange={(e) => set({ avoid: e.target.value })} maxLength={2000} placeholder="e.g. Emojis, long disclaimers, imperial units…" />
          </Field>
        </div>
      </div>
    </div>
  );
}

function MemoryTab() {
  const t = useT();
  const s = useApp((x) => x.settings);
  const update = useApp((x) => x.updateSettings);
  const memories = useApp((x) => x.memories);
  const { addMemory, updateMemory, deleteMemory, clearMemories } = useApp.getState();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  return (
    <div className="space-y-5">
      <Switch checked={s.memoryEnabled} onChange={(v) => update({ memoryEnabled: v })} label={t('memoryEnabled')} description="The AI only saves information when it is clearly useful or when you ask it to remember something. You'll see a notification each time." />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) void addMemory(draft.trim(), 'manual');
          setDraft('');
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a memory manually, e.g. “I prefer metric units”" maxLength={500} />
        <Button type="submit" icon={<Plus className="size-4" />} disabled={!draft.trim()}>
          Add
        </Button>
      </form>
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {memories.length === 0 && <li className="p-4 text-center text-sm text-muted">No memories yet.</li>}
        {memories.map((m) => (
          <li key={m.id} className="flex items-start gap-2 p-3">
            {editing === m.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void updateMemory(m.id, editText);
                  setEditing(null);
                }}
              >
                <Input autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={500} />
                <Button type="submit" size="sm" variant="primary">
                  {t('save')}
                </Button>
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1 text-sm">{m.content}</span>
                <span className="shrink-0 text-[11px] text-faint">{new Date(m.createdAt).toLocaleDateString()}</span>
                <IconButton size="sm" label={t('edit')} onClick={() => (setEditing(m.id), setEditText(m.content))}>
                  <Pencil />
                </IconButton>
                <IconButton size="sm" label={t('delete')} onClick={() => deleteMemory(m.id)}>
                  <Trash2 />
                </IconButton>
              </>
            )}
          </li>
        ))}
      </ul>
      {memories.length > 0 && (
        <Button variant="outline" className="text-danger" icon={<Trash2 className="size-4" />} onClick={() => confirm('Delete all memories?') && clearMemories()}>
          {t('clearMemories')}
        </Button>
      )}
    </div>
  );
}

const EMPTY_MODE: CustomModeDef = { id: '', name: '', description: '', instructions: '', personality: '', model: '', tier: 'auto', temperature: 0.7, tools: ['calculator', 'datetime'] };

function ModesTab() {
  const t = useT();
  const modes = useApp((x) => x.modes);
  const models = useApp((x) => x.models);
  const { saveMode, deleteMode } = useApp.getState();
  const [edit, setEdit] = useState<CustomModeDef | null>(null);
  if (edit) {
    const set = (p: Partial<CustomModeDef>) => setEdit({ ...edit, ...p });
    const toggleTool = (n: ToolName) => set({ tools: edit.tools.includes(n) ? edit.tools.filter((x) => x !== n) : [...edit.tools, n] });
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={edit.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} placeholder="e.g. Spanish Tutor" />
          </Field>
          <Field label="Description">
            <Input value={edit.description ?? ''} onChange={(e) => set({ description: e.target.value })} maxLength={500} placeholder="Shown in the mode picker" />
          </Field>
        </div>
        <Field label="System instructions" hint="How the AI should behave in this mode.">
          <Textarea value={edit.instructions} onChange={(e) => set({ instructions: e.target.value })} maxLength={8000} className="min-h-[140px]" placeholder="You are a patient Spanish tutor. Correct my mistakes gently and…" />
        </Field>
        <Field label="Personality">
          <Input value={edit.personality ?? ''} onChange={(e) => set({ personality: e.target.value })} maxLength={1000} placeholder="e.g. Upbeat and encouraging" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Preferred model">
            <Select value={edit.model ?? ''} onChange={(e) => set({ model: e.target.value })}>
              <option value="">Automatic (use tier)</option>
              {models?.providers.map((p) => (
                <optgroup key={p.id} label={p.label}>
                  {p.models.slice(0, 80).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Tier">
            <Select value={edit.tier ?? 'auto'} onChange={(e) => set({ tier: e.target.value as CustomModeDef['tier'] })}>
              <option value="auto">Auto</option>
              <option value="fast">Fast</option>
              <option value="balanced">Balanced</option>
              <option value="powerful">Powerful</option>
            </Select>
          </Field>
        </div>
        <Field label={`Creativity (temperature) · ${(edit.temperature ?? 0.7).toFixed(1)}`} hint="Lower = focused and deterministic, higher = more creative. Some models ignore this.">
          <input type="range" min={0} max={1.5} step={0.1} value={edit.temperature ?? 0.7} onChange={(e) => set({ temperature: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
        </Field>
        <div>
          <div className="mb-2 text-[13px] font-medium">Enabled tools</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {ALL_TOOLS.filter((x) => x.name !== 'remember').map((tool) => (
              <label key={tool.name} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-hover">
                <input type="checkbox" className="accent-[var(--accent)]" checked={edit.tools.includes(tool.name)} onChange={() => toggleTool(tool.name)} />
                {tool.label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => setEdit(null)}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!edit.name.trim() || !edit.instructions.trim()}
            onClick={() => {
              void saveMode({ ...edit, id: edit.id || uid(), name: edit.name.trim() });
              setEdit(null);
            }}
          >
            {t('save')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Create your own modes with custom instructions, model, creativity and tools. They appear in the mode picker.</p>
      <ul className="space-y-2">
        {modes.map((m) => (
          <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <Bot className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{m.name}</span>
              <span className="block truncate text-xs text-muted">{m.description || m.instructions}</span>
            </span>
            <IconButton size="sm" label={t('edit')} onClick={() => setEdit(m)}>
              <Pencil />
            </IconButton>
            <IconButton size="sm" label={t('delete')} onClick={() => confirm(`Delete mode "${m.name}"?`) && deleteMode(m.id)}>
              <Trash2 />
            </IconButton>
          </li>
        ))}
      </ul>
      <Button icon={<Plus className="size-4" />} onClick={() => setEdit({ ...EMPTY_MODE })}>
        {t('createMode')}
      </Button>
    </div>
  );
}

function DataTab() {
  const store = data();
  const config = useApp((x) => x.config);
  const conversations = useApp((x) => x.conversations);
  const exportAll = async () => {
    const all = await Promise.all(conversations.map(async (c) => ({ ...c, messages: await store.listMessages(c.id) })));
    const st = useApp.getState();
    downloadText(
      JSON.stringify({ exportedAt: new Date().toISOString(), settings: st.settings, memories: st.memories, modes: st.modes, projects: st.projects, conversations: all }, null, 2),
      `lumora-export-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    );
  };
  return (
    <div className="space-y-6 text-sm">
      <Section title="Where your data lives">
        <ul className="list-disc space-y-1.5 pl-5 text-muted">
          <li>
            Conversations, memories, modes and settings are stored{' '}
            <strong className="text-fg">{store.kind === 'supabase' ? 'in your Supabase database (protected by row-level security)' : 'only in this browser (IndexedDB)'}</strong>.
          </li>
          <li>Uploaded files are read in your browser. Only the extracted text (or a resized image) is sent with your message to the AI provider you selected; original files are never uploaded or stored on the server.</li>
          <li>Messages are processed by the selected AI provider under its own data policy. Web searches send only the query to the configured search API.</li>
          <li>API keys stay on the server (Netlify environment variables) and are never sent to your browser.</li>
          <li>The admin log stores request metadata only (model, latency, token counts, error codes) — never message content.</li>
        </ul>
      </Section>
      <Section title="Export & delete">
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportAll}>Export all data (JSON)</Button>
          <Button
            variant="outline"
            className="text-danger"
            onClick={async () => {
              if (!confirm('Permanently delete ALL conversations, memories, modes, projects and settings?')) return;
              await store.deleteAll();
              location.href = '/';
            }}
          >
            Delete all data
          </Button>
        </div>
      </Section>
      {config && (
        <Section title="Limits">
          <p className="text-muted">
            Max file size {(config.limits.maxFileBytes / 1e6).toFixed(0)} MB · up to {config.limits.maxFiles} files per message · agent runs up to {config.limits.maxAgentSteps} steps.
          </p>
        </Section>
      )}
    </div>
  );
}

function AccountTab() {
  const config = useApp((x) => x.config);
  const session = useApp((x) => x.session);
  const signOut = useApp((x) => x.signOut);
  const modeText: Record<string, string> = {
    supabase: 'Supabase account (email/password or OAuth)',
    password: 'Owner password (single user)',
    none: 'No authentication (local development)',
    locked: 'Not configured',
  };
  return (
    <div className="space-y-6 text-sm">
      <Section title="Account">
        <div className="rounded-2xl border border-line p-4">
          <div className="text-muted">Sign-in method</div>
          <div className="font-medium">{modeText[config?.authMode ?? 'locked']}</div>
          {session?.email && (
            <>
              <div className="mt-3 text-muted">Email</div>
              <div className="font-medium">{session.email}</div>
            </>
          )}
          {session?.isAdmin && <div className="mt-3 inline-block rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">Admin</div>}
        </div>
        {config?.authMode !== 'none' && (
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        )}
      </Section>
      <Section title="Connected services" desc="Configured by the site owner with environment variables.">
        <div className="rounded-2xl border border-line p-4">
          <div className="text-muted">AI providers</div>
          <div className="font-medium">{config?.providers.length ? config.providers.map((p) => p.label).join(', ') : 'None — add an API key (see README)'}</div>
          <div className="mt-3 text-muted">Web search</div>
          <div className="font-medium">{config?.searchProvider ?? 'Not configured (optional)'}</div>
          <div className="mt-3 text-muted">Server voice transcription</div>
          <div className="font-medium">{config?.transcription ? 'Available' : 'Browser speech recognition only'}</div>
        </div>
      </Section>
    </div>
  );
}

export function SettingsDialog() {
  const t = useT();
  const tab = useApp((s) => s.settingsTab);
  const open = useApp((s) => s.openSettings);
  return (
    <Dialog open={!!tab} onClose={() => open(null)} title={t('settings')} size="lg">
      <div className="flex min-h-[480px] flex-col sm:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 sm:w-48 sm:flex-col sm:border-b-0 sm:border-r">
          {TABS.map((x) => (
            <button
              key={x.id}
              onClick={() => open(x.id)}
              className={cn('flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-[13.5px] transition-colors', tab === x.id ? 'bg-hover font-medium text-fg' : 'text-muted hover:bg-hover/70 hover:text-fg')}
            >
              <x.icon className="size-4" /> {t(x.label)}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 p-5">
          {tab === 'general' && <GeneralTab />}
          {tab === 'personalization' && <PersonalizationTab />}
          {tab === 'memory' && <MemoryTab />}
          {tab === 'modes' && <ModesTab />}
          {tab === 'data' && <DataTab />}
          {tab === 'account' && <AccountTab />}
        </div>
      </div>
    </Dialog>
  );
}
