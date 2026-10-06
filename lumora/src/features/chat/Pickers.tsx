import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, ChevronDown, Cpu, Eye, Gauge, RefreshCw, Rocket, Search, Wand2, Wrench, Zap, Plus } from 'lucide-react';
import { ALL_TOOLS, MODE_ORDER, MODES } from '@shared/modes';
import type { ModeId, ModelTier, ToolName } from '@shared/types';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';
import { useT } from '@/i18n';
import { ModeIcon } from '@/components/Icon';
import { MenuItem, MenuLabel, MenuSeparator, Popover } from '@/components/ui/Popover';
import { Switch } from '@/components/ui/Field';
import { cn } from '@/lib/utils';

const chip =
  'inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-panel px-3 text-[13px] font-medium text-muted transition-colors hover:text-fg hover:bg-hover data-[open=true]:bg-hover data-[open=true]:text-fg';

export function useModeLabel(mode: ModeId) {
  const t = useT();
  const modes = useApp((s) => s.modes);
  if (mode === 'auto') return { label: t('modeAuto'), icon: 'Wand2' };
  if (mode.startsWith('custom:')) {
    const m = modes.find((x) => `custom:${x.id}` === mode);
    return { label: m?.name ?? 'Custom', icon: 'Bot' };
  }
  return { label: MODES[mode as keyof typeof MODES]?.label ?? mode, icon: MODES[mode as keyof typeof MODES]?.icon ?? 'Sparkles' };
}

export function ModePicker() {
  const t = useT();
  const mode = useChat((s) => s.mode);
  const setMode = useChat((s) => s.setMode);
  const custom = useApp((s) => s.modes);
  const openSettings = useApp((s) => s.openSettings);
  const cur = useModeLabel(mode);
  return (
    <Popover
      side="top"
      className="w-[300px]"
      trigger={({ toggle, ref, open }) => (
        <button ref={ref} onClick={toggle} data-open={open} className={chip} aria-haspopup="menu">
          <ModeIcon name={cur.icon} className="size-3.5 text-accent" />
          <span className="max-w-[110px] truncate">{cur.label}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon={<Wand2 />} active={mode === 'auto'} hint={mode === 'auto' && <Check className="size-4 text-accent" />} onClick={() => (setMode('auto'), close())}>
            <div className="font-medium">{t('modeAuto')}</div>
            <div className="text-xs text-muted">{t('modeAutoDesc')}</div>
          </MenuItem>
          <MenuSeparator />
          {MODE_ORDER.map((id) => (
            <MenuItem key={id} icon={<ModeIcon name={MODES[id].icon} />} active={mode === id} hint={mode === id && <Check className="size-4 text-accent" />} onClick={() => (setMode(id), close())}>
              <div className="font-medium">{MODES[id].label}</div>
              <div className="text-xs text-muted">{MODES[id].tagline}</div>
            </MenuItem>
          ))}
          {custom.length > 0 && <MenuLabel>Custom</MenuLabel>}
          {custom.map((m) => (
            <MenuItem key={m.id} icon={<Bot />} active={mode === `custom:${m.id}`} onClick={() => (setMode(`custom:${m.id}`), close())}>
              <div className="font-medium">{m.name}</div>
              {m.description && <div className="line-clamp-1 text-xs text-muted">{m.description}</div>}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon={<Plus />} onClick={() => (openSettings('modes'), close())}>
            {t('createMode')}
          </MenuItem>
        </>
      )}
    </Popover>
  );
}

const TIER_ICONS: Record<ModelTier, typeof Zap> = { auto: Wand2, fast: Zap, balanced: Gauge, powerful: Rocket };

export function ModelPicker() {
  const t = useT();
  const model = useChat((s) => s.model);
  const setModel = useChat((s) => s.setModel);
  const models = useApp((s) => s.models);
  const modelsError = useApp((s) => s.modelsError);
  const loadModels = useApp((s) => s.loadModels);
  const [q, setQ] = useState('');
  const [openSignal, setOpenSignal] = useState(0);

  useEffect(() => {
    const h = () => setOpenSignal((n) => n + 1);
    document.addEventListener('lumora:open-model-picker', h);
    return () => document.removeEventListener('lumora:open-model-picker', h);
  }, []);

  const label = model.kind === 'tier' ? t(model.tier === 'auto' ? 'modelAuto' : model.tier) : (model.id.split(':').slice(1).join(':') || model.id);
  const tiers: { tier: ModelTier; desc: string }[] = [
    { tier: 'auto', desc: t('modelAutoDesc') },
    { tier: 'fast', desc: t('fastDesc') },
    { tier: 'balanced', desc: t('balancedDesc') },
    { tier: 'powerful', desc: t('powerfulDesc') },
  ];
  const filtered = useMemo(
    () =>
      (models?.providers ?? []).map((p) => ({
        ...p,
        models: p.models.filter((m) => !q || m.model.toLowerCase().includes(q.toLowerCase()) || m.label.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 60 : 25),
      })),
    [models, q],
  );

  return (
    <Popover
      side="top"
      align="start"
      className="w-[340px]"
      trigger={({ toggle, ref, open }) => (
        <OpenOnSignal signal={openSignal} open={open} toggle={toggle}>
          <button ref={ref} onClick={toggle} data-open={open} className={chip} aria-haspopup="menu">
            <Cpu className="size-3.5 text-accent-2" />
            <span className="max-w-[140px] truncate">{label}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </button>
        </OpenOnSignal>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>{t('model')}</MenuLabel>
          {tiers.map(({ tier, desc }) => {
            const I = TIER_ICONS[tier];
            const active = model.kind === 'tier' && model.tier === tier;
            const target = tier === 'auto' ? undefined : models?.tiers[tier];
            return (
              <MenuItem key={tier} icon={<I />} active={active} hint={active && <Check className="size-4 text-accent" />} onClick={() => (setModel({ kind: 'tier', tier }), close())}>
                <div className="font-medium">{t(tier === 'auto' ? 'modelAuto' : tier)}</div>
                <div className="truncate text-xs text-muted">{target ? target.split(':').slice(1).join(':') : desc}</div>
              </MenuItem>
            );
          })}
          <MenuSeparator />
          <div className="relative px-1 pb-1">
            <Search className="pointer-events-none absolute left-3.5 top-2.5 size-3.5 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search models…"
              className="h-9 w-full rounded-xl border border-line bg-bg pl-8 pr-8 text-[13px] outline-none focus:border-accent/60"
            />
            <button title="Refresh model list" className="absolute right-3 top-2.5 text-faint hover:text-fg" onClick={() => loadModels(true)}>
              <RefreshCw className="size-3.5" />
            </button>
          </div>
          {modelsError && <div className="px-2.5 py-2 text-xs text-danger">{modelsError}</div>}
          {!models && !modelsError && <div className="px-2.5 py-2 text-xs text-muted">Loading models…</div>}
          {models && !models.providers.length && <div className="px-2.5 py-2 text-xs text-muted">No providers configured. Add an API key in your environment variables.</div>}
          {filtered.map((p) => (
            <div key={p.id}>
              <MenuLabel>
                {p.label}
                {p.error && <span className="ml-1 normal-case tracking-normal text-warn">· defaults</span>}
              </MenuLabel>
              {p.models.map((m) => {
                const active = model.kind === 'model' && model.id === m.id;
                return (
                  <MenuItem
                    key={m.id}
                    active={active}
                    hint={<span className="flex items-center gap-1">{m.vision && <Eye className="size-3.5" />}{active && <Check className="size-4 text-accent" />}</span>}
                    onClick={() => (setModel({ kind: 'model', id: m.id }), close())}
                  >
                    <div className="truncate">{m.label}</div>
                    {m.label !== m.model && <div className="truncate text-[11px] text-faint">{m.model}</div>}
                  </MenuItem>
                );
              })}
            </div>
          ))}
        </>
      )}
    </Popover>
  );
}

function OpenOnSignal({ signal, open, toggle, children }: { signal: number; open: boolean; toggle: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (signal && !open) toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);
  return <>{children}</>;
}

export function ToolsMenu() {
  const t = useT();
  const mode = useChat((s) => s.mode);
  const tools = useChat((s) => s.tools);
  const setTools = useChat((s) => s.setTools);
  const agent = useChat((s) => s.agent);
  const setAgent = useChat((s) => s.setAgent);
  const config = useApp((s) => s.config);
  const customModes = useApp((s) => s.modes);
  const memoryEnabled = useApp((s) => s.settings.memoryEnabled);
  const defaults: ToolName[] = mode.startsWith('custom:')
    ? (customModes.find((m) => `custom:${m.id}` === mode)?.tools ?? [])
    : mode === 'auto'
      ? ['web_search', 'read_url', 'calculator', 'datetime', 'weather', 'run_code', 'data_analysis', 'json_tool']
      : MODES[mode as keyof typeof MODES]?.tools ?? [];
  const active = new Set(tools ?? defaults);
  const toggle = (name: ToolName) => {
    const next = new Set(active);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setTools([...next]);
  };
  const count = tools ? tools.length : null;
  return (
    <Popover
      side="top"
      className="w-[320px]"
      trigger={({ toggle: tg, ref, open }) => (
        <button ref={ref} onClick={tg} data-open={open} className={cn(chip, (agent || tools) && 'text-fg')} aria-haspopup="menu">
          <Wrench className="size-3.5" />
          <span className="hidden sm:inline">{t('tools')}</span>
          {agent && <span className="rounded-full bg-accent/15 px-1.5 text-[11px] text-accent">agent</span>}
          {count !== null && !agent && <span className="text-[11px] text-faint">{count}</span>}
        </button>
      )}
    >
      {() => (
        <div className="p-1.5">
          <Switch checked={agent} onChange={setAgent} label={t('agentMode')} description={t('agentModeDesc')} />
          <div className="my-2 h-px bg-line" />
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">{t('tools')}</span>
            {tools && (
              <button className="text-xs text-accent hover:underline" onClick={() => setTools(null)}>
                Reset to mode defaults
              </button>
            )}
          </div>
          {ALL_TOOLS.filter((x) => x.name !== 'remember').map((tool) => {
            const unavailable = tool.name === 'web_search' && !config?.searchProvider;
            return (
              <label key={tool.name} className={cn('flex cursor-pointer items-start gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-hover', unavailable && 'cursor-not-allowed opacity-50')}>
                <input type="checkbox" className="mt-1 accent-[var(--accent)]" disabled={unavailable} checked={active.has(tool.name) && !unavailable} onChange={() => toggle(tool.name)} />
                <span>
                  <span className="block text-[13px] font-medium">{tool.label}</span>
                  <span className="block text-xs text-muted">{unavailable ? 'Requires a search provider (SEARCH_PROVIDER)' : tool.description}</span>
                </span>
              </label>
            );
          })}
          <div className="mt-1 px-1.5 text-xs text-faint">Memory tool: {memoryEnabled ? 'on' : 'off'} (Settings → Memory)</div>
        </div>
      )}
    </Popover>
  );
}
