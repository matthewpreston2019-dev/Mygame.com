// Structured event log for the admin panel (requests, latency, token usage, errors, tool failures).
// Events never include message content or API keys.

import { kv } from './kv';

export interface AdminEvent {
  ts: number;
  kind: 'request' | 'error' | 'tool' | 'auth';
  user?: string;
  provider?: string;
  model?: string;
  mode?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  tool?: string;
  ok?: boolean;
  code?: string;
  detail?: string;
}

const store = () => kv('lumora-events');

export async function logEvent(e: Omit<AdminEvent, 'ts'>): Promise<void> {
  const ev: AdminEvent = { ts: Date.now(), ...e, detail: e.detail?.slice(0, 500) };
  const day = new Date(ev.ts).toISOString().slice(0, 10);
  const key = `ev/${day}/${String(ev.ts).padStart(15, '0')}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await store().set(key, ev);
  } catch (err) {
    console.warn('[lumora] failed to write admin event', err);
  }
  if (e.kind === 'error') console.error('[lumora]', e.code, e.provider ?? '', e.model ?? '', e.detail ?? '');
}

export async function recentEvents(days = 2, limit = 300): Promise<AdminEvent[]> {
  const s = store();
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    keys.push(...(await s.list(`ev/${day}/`)));
  }
  keys.sort().reverse();
  const selected = keys.slice(0, limit);
  const events = await Promise.all(selected.map((k) => s.get<AdminEvent>(k)));
  return events.filter((e): e is AdminEvent => !!e);
}
