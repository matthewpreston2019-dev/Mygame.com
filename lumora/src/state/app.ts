import { create } from 'zustand';
import type { ModelInfo, PublicConfig, SessionInfo, TierMap } from '@shared/types';
import { apiJson } from '@/lib/api';
import { data, selectLocalStore, selectSupabaseStore } from '@/data/store';
import { DEFAULT_SETTINGS, type Conversation, type CustomModeDef, type Memory, type Project, type Settings } from '@/data/types';
import { initSupabase, supabase } from '@/lib/supabase';
import { uid } from '@/lib/utils';

export interface ProviderModels {
  id: string;
  label: string;
  kind: string;
  models: ModelInfo[];
  error?: string;
}

export interface Toast {
  id: string;
  message: string;
  tone?: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

type SettingsTab = 'general' | 'personalization' | 'memory' | 'modes' | 'data' | 'account';

interface AppState {
  booted: boolean;
  bootError: string | null;
  config: PublicConfig | null;
  session: SessionInfo | null;
  settings: Settings;
  conversations: Conversation[];
  projects: Project[];
  modes: CustomModeDef[];
  memories: Memory[];
  models: { providers: ProviderModels[]; tiers: TierMap } | null;
  modelsError: string | null;
  sidebarOpen: boolean;
  settingsTab: SettingsTab | null;
  projectDialog: string | null; // project id or 'new'
  activeProjectId: string | null;
  toasts: Toast[];

  boot(): Promise<void>;
  refreshSession(): Promise<void>;
  loadData(): Promise<void>;
  loadModels(force?: boolean): Promise<void>;
  updateSettings(patch: Partial<Settings>): void;
  upsertConversation(c: Conversation): Promise<void>;
  patchConversation(id: string, patch: Partial<Conversation>): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  saveMode(m: CustomModeDef): Promise<void>;
  deleteMode(id: string): Promise<void>;
  addMemory(content: string, source?: string): Promise<Memory>;
  updateMemory(id: string, content: string): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  clearMemories(): Promise<void>;
  setSidebar(open: boolean): void;
  openSettings(tab: SettingsTab | null): void;
  openProject(id: string | null): void;
  setActiveProject(id: string | null): void;
  toast(message: string, opts?: Omit<Toast, 'id' | 'message'>): void;
  dismissToast(id: string): void;
  signOut(): Promise<void>;
}

const THEME_KEY = 'lumora-theme';

export function applyTheme(theme: Settings['theme']) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode */
  }
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b12' : '#f7f7fa');
}

let settingsTimer: ReturnType<typeof setTimeout> | undefined;

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  bootError: null,
  config: null,
  session: null,
  settings: { ...DEFAULT_SETTINGS, theme: ((typeof localStorage !== 'undefined' && localStorage.getItem(THEME_KEY)) as Settings['theme']) || 'system' },
  conversations: [],
  projects: [],
  modes: [],
  memories: [],
  models: null,
  modelsError: null,
  sidebarOpen: false,
  settingsTab: null,
  projectDialog: null,
  activeProjectId: null,
  toasts: [],

  async boot() {
    try {
      const { config, session } = await apiJson<{ config: PublicConfig; session: SessionInfo }>('/api/config');
      if (config.authMode === 'supabase' && config.supabase) {
        const sb = await initSupabase(config.supabase.url, config.supabase.anonKey);
        selectSupabaseStore(sb);
        sb.auth.onAuthStateChange((event) => {
          if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') void get().refreshSession();
        });
        const { data: s } = await sb.auth.getSession();
        set({ config, session: s.session ? await apiJson<{ session: SessionInfo }>('/api/config').then((r) => r.session) : { authenticated: false } });
      } else {
        selectLocalStore();
        set({ config, session });
      }
      if (get().session?.authenticated) await get().loadData();
      set({ booted: true });
    } catch (err) {
      set({ booted: true, bootError: (err as Error).message });
    }
  },

  async refreshSession() {
    const { config, session } = await apiJson<{ config: PublicConfig; session: SessionInfo }>('/api/config');
    const was = get().session?.authenticated;
    set({ config, session });
    if (session.authenticated && !was) await get().loadData();
  },

  async loadData() {
    const store = data();
    const [conversations, projects, modes, memories, saved] = await Promise.all([
      store.listConversations(),
      store.listProjects(),
      store.listModes(),
      store.listMemories(),
      store.getSettings(),
    ]);
    const settings: Settings = { ...DEFAULT_SETTINGS, ...get().settings, ...(saved ?? {}) };
    settings.instructions = { ...DEFAULT_SETTINGS.instructions, ...(saved?.instructions ?? {}) };
    settings.voice = { ...DEFAULT_SETTINGS.voice, ...(saved?.voice ?? {}) };
    applyTheme(settings.theme);
    set({ conversations, projects, modes, memories, settings });
    void get().loadModels();
  },

  async loadModels(force) {
    try {
      const res = await apiJson<{ providers: ProviderModels[]; tiers: TierMap }>(`/api/models${force ? '?refresh=1' : ''}`);
      set({ models: res, modelsError: null });
    } catch (err) {
      set({ modelsError: (err as Error).message });
    }
  },

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    if (patch.theme) applyTheme(patch.theme);
    set({ settings });
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => void data().saveSettings(get().settings).catch(() => get().toast('Could not save settings', { tone: 'error' })), 400);
  },

  async upsertConversation(c) {
    const list = get().conversations.filter((x) => x.id !== c.id);
    set({ conversations: [c, ...list].sort((a, b) => b.updatedAt - a.updatedAt) });
    await data().saveConversation(c);
  },

  async patchConversation(id, patch) {
    const c = get().conversations.find((x) => x.id === id);
    if (!c) return;
    const next = { ...c, ...patch };
    set({ conversations: get().conversations.map((x) => (x.id === id ? next : x)) });
    await data().saveConversation(next);
  },

  async deleteConversation(id) {
    set({ conversations: get().conversations.filter((c) => c.id !== id) });
    await data().deleteConversation(id);
  },

  async saveProject(p) {
    set({ projects: [...get().projects.filter((x) => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name)) });
    await data().saveProject(p);
  },

  async deleteProject(id) {
    set({
      projects: get().projects.filter((p) => p.id !== id),
      conversations: get().conversations.map((c) => (c.projectId === id ? { ...c, projectId: null } : c)),
      activeProjectId: get().activeProjectId === id ? null : get().activeProjectId,
    });
    await data().deleteProject(id);
  },

  async saveMode(m) {
    set({ modes: [...get().modes.filter((x) => x.id !== m.id), m] });
    await data().saveMode(m);
  },

  async deleteMode(id) {
    set({ modes: get().modes.filter((m) => m.id !== id) });
    await data().deleteMode(id);
  },

  async addMemory(content, source) {
    const m: Memory = { id: uid(), content: content.slice(0, 500), source, createdAt: Date.now(), updatedAt: Date.now() };
    set({ memories: [m, ...get().memories] });
    await data().saveMemory(m);
    return m;
  },

  async updateMemory(id, content) {
    const m = get().memories.find((x) => x.id === id);
    if (!m) return;
    const next = { ...m, content: content.slice(0, 500), updatedAt: Date.now() };
    set({ memories: get().memories.map((x) => (x.id === id ? next : x)) });
    await data().saveMemory(next);
  },

  async deleteMemory(id) {
    set({ memories: get().memories.filter((m) => m.id !== id) });
    await data().deleteMemory(id);
  },

  async clearMemories() {
    set({ memories: [] });
    await data().clearMemories();
  },

  setSidebar: (open) => set({ sidebarOpen: open }),
  openSettings: (tab) => set({ settingsTab: tab }),
  openProject: (id) => set({ projectDialog: id }),
  setActiveProject: (id) => set({ activeProjectId: id }),

  toast(message, opts) {
    const id = uid();
    set({ toasts: [...get().toasts, { id, message, ...opts }] });
    setTimeout(() => get().dismissToast(id), opts?.action ? 7000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  async signOut() {
    const cfg = get().config;
    if (cfg?.authMode === 'supabase') await supabase()?.auth.signOut();
    else await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-lumora': '1' }, credentials: 'same-origin' });
    set({ session: { authenticated: false }, conversations: [], projects: [], modes: [], memories: [], models: null });
  },
}));
