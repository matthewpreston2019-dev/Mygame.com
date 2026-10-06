// Storage abstraction. Two interchangeable backends:
//  - LocalStore: IndexedDB in this browser (password / no-auth modes). Nothing leaves the device.
//  - SupabaseStore: Postgres with Row Level Security (supabase mode), synced across devices.
// Swap or add backends by implementing DataStore.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createStore, del, entries, get, set, setMany, delMany, clear, type UseStore } from 'idb-keyval';
import type { CodeFile, Conversation, CustomModeDef, Memory, Message, Project, ProjectFile, Settings, SharedSnapshot } from './types';

export interface DataStore {
  readonly kind: 'local' | 'supabase';
  listConversations(): Promise<Conversation[]>;
  saveConversation(c: Conversation): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  listMessages(conversationId: string): Promise<Message[]>;
  saveMessage(m: Message): Promise<void>;
  deleteMessages(ids: string[]): Promise<void>;
  listMemories(): Promise<Memory[]>;
  saveMemory(m: Memory): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  clearMemories(): Promise<void>;
  listModes(): Promise<CustomModeDef[]>;
  saveMode(m: CustomModeDef): Promise<void>;
  deleteMode(id: string): Promise<void>;
  listProjects(): Promise<Project[]>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  listProjectFiles(projectId: string): Promise<ProjectFile[]>;
  saveProjectFile(f: ProjectFile): Promise<void>;
  deleteProjectFile(id: string): Promise<void>;
  getSettings(): Promise<Partial<Settings> | null>;
  saveSettings(s: Settings): Promise<void>;
  /** Returns a share id, or null if this backend cannot host public links. */
  createShare(snapshot: SharedSnapshot): Promise<string | null>;
  deleteAll(): Promise<void>;
}

// Code workspace files always live in this browser (IndexedDB).
const codeDb = () => createStore('lumora-code', 'files');
export const codeStore = {
  async list(): Promise<CodeFile[]> {
    return (await entries<string, CodeFile>(codeDb())).map(([, v]) => v).sort((a, b) => a.path.localeCompare(b.path));
  },
  save: (f: CodeFile) => set(f.path, f, codeDb()),
  remove: (path: string) => del(path, codeDb()),
  async replaceAll(files: CodeFile[]) {
    const db = codeDb();
    await clear(db);
    await setMany(files.map((f) => [f.path, f]), db);
  },
};

// ------------------------------------------------------------------------------------------------

class LocalStore implements DataStore {
  readonly kind = 'local' as const;
  private dbs = new Map<string, UseStore>();
  private db(name: string) {
    let s = this.dbs.get(name);
    if (!s) {
      s = createStore(`lumora-${name}`, 'kv');
      this.dbs.set(name, s);
    }
    return s;
  }
  private async all<T>(name: string): Promise<T[]> {
    return (await entries<string, T>(this.db(name))).map(([, v]) => v);
  }

  async listConversations() {
    return (await this.all<Conversation>('conversations')).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  saveConversation(c: Conversation) {
    return set(c.id, c, this.db('conversations'));
  }
  async deleteConversation(id: string) {
    const msgs = await this.listMessages(id);
    await delMany(msgs.map((m) => m.id), this.db('messages'));
    await del(id, this.db('conversations'));
  }
  async listMessages(conversationId: string) {
    return (await this.all<Message>('messages')).filter((m) => m.conversationId === conversationId).sort((a, b) => a.createdAt - b.createdAt);
  }
  saveMessage(m: Message) {
    return set(m.id, m, this.db('messages'));
  }
  deleteMessages(ids: string[]) {
    return delMany(ids, this.db('messages'));
  }
  async listMemories() {
    return (await this.all<Memory>('memories')).sort((a, b) => b.createdAt - a.createdAt);
  }
  saveMemory(m: Memory) {
    return set(m.id, m, this.db('memories'));
  }
  deleteMemory(id: string) {
    return del(id, this.db('memories'));
  }
  clearMemories() {
    return clear(this.db('memories'));
  }
  listModes() {
    return this.all<CustomModeDef>('modes');
  }
  saveMode(m: CustomModeDef) {
    return set(m.id, m, this.db('modes'));
  }
  deleteMode(id: string) {
    return del(id, this.db('modes'));
  }
  async listProjects() {
    return (await this.all<Project>('projects')).sort((a, b) => a.name.localeCompare(b.name));
  }
  saveProject(p: Project) {
    return set(p.id, p, this.db('projects'));
  }
  async deleteProject(id: string) {
    const files = await this.listProjectFiles(id);
    await delMany(files.map((f) => f.id), this.db('projectFiles'));
    for (const c of await this.listConversations()) if (c.projectId === id) await this.saveConversation({ ...c, projectId: null });
    await del(id, this.db('projects'));
  }
  async listProjectFiles(projectId: string) {
    return (await this.all<ProjectFile>('projectFiles')).filter((f) => f.projectId === projectId);
  }
  saveProjectFile(f: ProjectFile) {
    return set(f.id, f, this.db('projectFiles'));
  }
  deleteProjectFile(id: string) {
    return del(id, this.db('projectFiles'));
  }
  async getSettings() {
    return (await get<Settings>('settings', this.db('settings'))) ?? null;
  }
  saveSettings(s: Settings) {
    return set('settings', s, this.db('settings'));
  }
  async createShare() {
    return null;
  }
  async deleteAll() {
    for (const n of ['conversations', 'messages', 'memories', 'modes', 'projects', 'projectFiles', 'settings']) await clear(this.db(n));
  }
}

// ------------------------------------------------------------------------------------------------

const ts = (n: number) => new Date(n).toISOString();
const ms = (s: string | null | undefined) => (s ? new Date(s).getTime() : Date.now());

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

class SupabaseStore implements DataStore {
  readonly kind = 'supabase' as const;
  constructor(private sb: SupabaseClient) {}

  async listConversations() {
    const rows = check(await this.sb.from('conversations').select('*').order('updated_at', { ascending: false }).limit(1000)) as Record<string, unknown>[];
    return rows.map(
      (r): Conversation => ({
        id: r.id as string,
        title: r.title as string,
        createdAt: ms(r.created_at as string),
        updatedAt: ms(r.updated_at as string),
        pinned: !!r.pinned,
        archived: !!r.archived,
        projectId: (r.project_id as string) ?? null,
        mode: (r.mode as Conversation['mode']) ?? undefined,
        model: (r.model as string) ?? undefined,
      }),
    );
  }
  async saveConversation(c: Conversation) {
    check(
      await this.sb.from('conversations').upsert({
        id: c.id,
        title: c.title.slice(0, 300),
        created_at: ts(c.createdAt),
        updated_at: ts(c.updatedAt),
        pinned: !!c.pinned,
        archived: !!c.archived,
        project_id: c.projectId ?? null,
        mode: c.mode ?? null,
        model: c.model ?? null,
      }),
    );
  }
  async deleteConversation(id: string) {
    check(await this.sb.from('conversations').delete().eq('id', id));
  }
  async listMessages(conversationId: string) {
    const rows = check(await this.sb.from('messages').select('*').eq('conversation_id', conversationId).order('created_at')) as Record<string, unknown>[];
    return rows.map((r) => ({ ...(r.data as object), id: r.id, conversationId, role: r.role, content: r.content, createdAt: ms(r.created_at as string) }) as Message);
  }
  async saveMessage(m: Message) {
    const { id, conversationId, role, content, createdAt, ...data } = m;
    check(await this.sb.from('messages').upsert({ id, conversation_id: conversationId, role, content, created_at: ts(createdAt), data }));
  }
  async deleteMessages(ids: string[]) {
    if (ids.length) check(await this.sb.from('messages').delete().in('id', ids));
  }
  async listMemories() {
    const rows = check(await this.sb.from('memories').select('*').order('created_at', { ascending: false })) as Record<string, unknown>[];
    return rows.map((r) => ({ id: r.id as string, content: r.content as string, source: (r.source as string) ?? undefined, createdAt: ms(r.created_at as string), updatedAt: ms(r.updated_at as string) }));
  }
  async saveMemory(m: Memory) {
    check(await this.sb.from('memories').upsert({ id: m.id, content: m.content.slice(0, 500), source: m.source ?? null, created_at: ts(m.createdAt), updated_at: ts(m.updatedAt) }));
  }
  async deleteMemory(id: string) {
    check(await this.sb.from('memories').delete().eq('id', id));
  }
  async clearMemories() {
    check(await this.sb.from('memories').delete().neq('id', ''));
  }
  async listModes() {
    const rows = check(await this.sb.from('custom_modes').select('data')) as { data: CustomModeDef }[];
    return rows.map((r) => r.data);
  }
  async saveMode(m: CustomModeDef) {
    check(await this.sb.from('custom_modes').upsert({ id: m.id, data: m, updated_at: ts(Date.now()) }));
  }
  async deleteMode(id: string) {
    check(await this.sb.from('custom_modes').delete().eq('id', id));
  }
  async listProjects() {
    const rows = check(await this.sb.from('projects').select('*').order('name')) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      instructions: (r.instructions as string) ?? '',
      preferredMode: (r.preferred_mode as Project['preferredMode']) ?? undefined,
      preferredModel: (r.preferred_model as string) ?? undefined,
      color: ((r.data as { color?: string }) ?? {}).color,
      createdAt: ms(r.created_at as string),
      updatedAt: ms(r.updated_at as string),
    }));
  }
  async saveProject(p: Project) {
    check(
      await this.sb.from('projects').upsert({
        id: p.id,
        name: p.name,
        instructions: p.instructions,
        preferred_mode: p.preferredMode ?? null,
        preferred_model: p.preferredModel ?? null,
        data: { color: p.color },
        created_at: ts(p.createdAt),
        updated_at: ts(p.updatedAt),
      }),
    );
  }
  async deleteProject(id: string) {
    check(await this.sb.from('projects').delete().eq('id', id));
  }
  async listProjectFiles(projectId: string) {
    const rows = check(await this.sb.from('files').select('*').eq('project_id', projectId)) as Record<string, unknown>[];
    return rows.map((r) => ({ id: r.id as string, projectId, name: r.name as string, mime: r.mime as string, size: Number(r.size), text: (r.text_content as string) ?? '', createdAt: ms(r.created_at as string) }));
  }
  async saveProjectFile(f: ProjectFile) {
    check(await this.sb.from('files').upsert({ id: f.id, project_id: f.projectId, name: f.name, mime: f.mime, size: f.size, text_content: f.text, created_at: ts(f.createdAt) }));
  }
  async deleteProjectFile(id: string) {
    check(await this.sb.from('files').delete().eq('id', id));
  }
  async getSettings() {
    const rows = check(await this.sb.from('user_settings').select('data').limit(1)) as { data: Partial<Settings> }[];
    return rows[0]?.data ?? null;
  }
  async saveSettings(s: Settings) {
    const { data } = await this.sb.auth.getUser();
    if (!data.user) return;
    check(await this.sb.from('user_settings').upsert({ user_id: data.user.id, data: s, updated_at: ts(Date.now()) }));
  }
  async createShare(snapshot: SharedSnapshot) {
    const id = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    check(await this.sb.from('shared_conversations').insert({ id, title: snapshot.title, data: snapshot }));
    return id;
  }
  async deleteAll() {
    for (const t of ['shared_conversations', 'messages', 'conversations', 'memories', 'custom_modes', 'files', 'projects', 'user_settings'])
      check(await this.sb.from(t).delete().neq(t === 'user_settings' ? 'updated_at' : 'id', t === 'user_settings' ? '1970-01-01' : ''));
  }
}

let current: DataStore = new LocalStore();
export const data = (): DataStore => current;
export function selectSupabaseStore(sb: SupabaseClient) {
  current = new SupabaseStore(sb);
}
export function selectLocalStore() {
  current = new LocalStore();
}
