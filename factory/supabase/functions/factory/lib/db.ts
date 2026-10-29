// Database access shared by every module: the admin client, settings, secrets, tasks, chat and logs.
import { createClient } from 'npm:@supabase/supabase-js@2';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1/factory`;

const secretKey = (() => {
  try {
    return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
  } catch {
    return undefined;
  }
})() ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Server client: bypasses RLS. Never sent to the browser. */
export const db = createClient(SUPABASE_URL, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Unwrap a Supabase response: return the data or throw its error. */
// deno-lint-ignore no-explicit-any
export function must(res: { data: any; error: { message: string } | null }): any {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export const now = () => new Date().toISOString();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Settings & secrets ──────────────────────────────────

export type Settings = Record<string, any>;
export const getSettings = async (): Promise<Settings> => must(await db.from('settings').select('*').eq('id', 1).single());
export const updateSettings = async (changes: Settings) => must(await db.from('settings').update({ ...changes, updated_at: now() }).eq('id', 1).select().single());

const secrets = new Map<string, { value: string | null; at: number }>();

/** Server-only secrets (API keys, tokens), cached for a minute per worker instance. */
export async function getSecret(key: string): Promise<string | null> {
  const hit = secrets.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const row = must(await db.from('app_secrets').select('value').eq('key', key).maybeSingle());
  secrets.set(key, { value: row?.value ?? null, at: Date.now() });
  return row?.value ?? null;
}

export async function setSecret(key: string, value: string) {
  must(await db.from('app_secrets').upsert({ key, value, updated_at: now() }));
  secrets.set(key, { value, at: Date.now() });
}

export async function deleteSecret(key: string) {
  must(await db.from('app_secrets').delete().eq('key', key));
  secrets.delete(key);
}

// ── Tasks, chat, logs ───────────────────────────────────

export type Task = Record<string, any>;
export const getTask = async (id: string): Promise<Task | null> => must(await db.from('tasks').select('*').eq('id', id).maybeSingle());

/** Every update also refreshes the heartbeat, so the scheduler can tell a live worker from a stopped one. */
export const updateTask = async (id: string, changes: Task) => must(await db.from('tasks').update({ ...changes, heartbeat_at: now() }).eq('id', id));

export async function addChat(role: 'user' | 'manager', text: string, extra: Record<string, unknown> = {}) {
  return must(await db.from('chat').insert({ role, text, ...extra }).select().single());
}

export async function log(level: 'info' | 'error', event: string, data: Record<string, unknown> = {}) {
  if (level === 'error') console.error(event, data);
  await db.from('logs').insert({ level, event, data });
}
