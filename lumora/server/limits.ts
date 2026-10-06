// Rate limiting, daily request caps and token budgets. Backed by Netlify Blobs so they hold across
// function instances. Small races are acceptable for a personal deployment.

import { env } from './env';
import { FRIENDLY, HttpError } from './http';
import { kv } from './kv';

const usage = () => kv('lumora-usage');

const today = () => new Date().toISOString().slice(0, 10);

interface Window {
  start: number;
  count: number;
}

export interface DailyUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

const safeKey = (s: string) => s.replace(/[^a-zA-Z0-9@._-]/g, '_').slice(0, 120);

/** Fixed-window limiter. Throws HttpError(429) when exceeded. */
export async function rateLimit(bucket: string, limit: number, windowMs: number): Promise<void> {
  if (limit <= 0) return;
  const key = `rl/${safeKey(bucket)}`;
  const store = usage();
  const now = Date.now();
  let w = (await store.get<Window>(key)) ?? { start: now, count: 0 };
  if (now - w.start > windowMs) w = { start: now, count: 0 };
  w.count += 1;
  await store.set(key, w);
  if (w.count > limit) throw new HttpError(429, 'rate_limited', FRIENDLY.rate_limited, true);
}

export async function getDailyUsage(userId: string, day = today()): Promise<DailyUsage> {
  return (await usage().get<DailyUsage>(`day/${day}/${safeKey(userId)}`)) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
}

/** Called before each model request. */
export async function checkQuota(userId: string): Promise<void> {
  await rateLimit(`chat/${userId}`, env.rateLimitPerMinute, 60_000);
  const u = await getDailyUsage(userId);
  if (env.dailyRequestLimit > 0 && u.requests >= env.dailyRequestLimit)
    throw new HttpError(429, 'budget_exceeded', FRIENDLY.budget_exceeded);
  if (env.dailyTokenBudget > 0 && u.inputTokens + u.outputTokens >= env.dailyTokenBudget)
    throw new HttpError(429, 'budget_exceeded', FRIENDLY.budget_exceeded);
}

export async function recordUsage(userId: string, inputTokens = 0, outputTokens = 0): Promise<void> {
  const key = `day/${today()}/${safeKey(userId)}`;
  const store = usage();
  const u = (await store.get<DailyUsage>(key)) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
  u.requests += 1;
  u.inputTokens += inputTokens;
  u.outputTokens += outputTokens;
  await store.set(key, u);
}
