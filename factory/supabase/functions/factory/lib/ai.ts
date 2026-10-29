// The only file that talks to the AI (Google Gemini, free tier).
//
//   fast      Flash-Lite — planning, checking, briefings, small skills
//   standard  Flash      — the workers' real work (+ Google Search for research)
//
// Every call counts against the daily allowance set in Settings, so the free
// quota is never exceeded silently.
import { db, getSecret, getSettings, updateSettings, must, sleep, type Settings } from './db.ts';
import { pickModels, toGeminiSchema, parseJson } from './logic.ts';

const API = 'https://generativelanguage.googleapis.com/v1beta';

/** A temporary problem (busy, network): the task is retried later. */
export class AIError extends Error {
  retryable: boolean;
  retryAfterMs: number;
  constructor(message: string, retryable = false, retryAfterMs = 0) {
    super(message);
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Today's free allowance is used up: the task pauses until tomorrow. */
export class LimitError extends Error {
  override name = 'LimitError';
}

/** 'live' (Gemini key saved), 'demo' (simulated output) or 'offline' (cannot run work yet). */
export const aiMode = (s: Settings) => (s.ai_ready ? 'live' : s.demo ? 'demo' : 'offline');

type AskOptions = {
  tier?: string;
  system: string;
  prompt: string;
  schema?: object;
  web?: boolean;
  maxTokens?: number;
  demo?: () => { text?: string; json?: unknown };
};

/** Ask Gemini once. Returns { text, json, sources, model, requests }. */
export async function ask({ tier = 'fast', system, prompt, schema, web = false, maxTokens = 4096, demo }: AskOptions) {
  const settings = await getSettings();
  const mode = aiMode(settings);
  if (mode === 'demo') return simulate(demo);
  if (mode === 'offline') throw new AIError('Add your free Gemini key in Settings → AI first.');

  const key = (await getSecret('gemini_api_key'))!;
  const model: string = tier === 'fast' ? settings.models.fast : settings.models.standard;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, ...(schema && { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) }) },
    ...(web && { tools: [{ google_search: {} }] }),
  };

  let data;
  let requests = 1;
  try {
    data = await call(key, model, body, settings);
  } catch (err) {
    // Search grounding isn't always available on the free tier: answer without it rather than fail.
    if (!web || !(err instanceof AIError) || err.retryable) throw err;
    requests++;
    data = await call(key, model, { ...body, tools: undefined }, settings);
  }

  const candidate = data.candidates?.[0];
  if (!candidate?.content) {
    const reason = data.promptFeedback?.blockReason || candidate?.finishReason || 'no answer';
    throw new AIError(`Gemini declined this request (${reason}).`);
  }
  const text = candidate.content.parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('').trim();
  if (candidate.finishReason === 'MAX_TOKENS' && schema) throw new AIError('The answer was cut off before it finished.', true, 1000);

  const sources = (candidate.groundingMetadata?.groundingChunks ?? [])
    .map((c: any) => c.web)
    .filter((w: any) => w?.uri)
    .slice(0, 6)
    .map((w: any) => ({ url: w.uri, title: w.title || w.uri }));

  return { text, json: schema ? parseJson(text) : null, sources, model, requests };
}

async function call(key: string, model: string, body: object, settings: Settings): Promise<any> {
  const allowed = must(await db.rpc('use_requests', { n: 1 }));
  if (!allowed) throw new LimitError(`Today's AI allowance (${settings.daily_request_limit} requests) is used up. Work continues tomorrow, or raise the limit in Settings.`);

  let res: Response;
  try {
    res = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(110_000),
    });
  } catch (err) {
    throw new AIError(`Could not reach Gemini (${(err as Error).message}).`, true, 15_000);
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;

  const message: string = data?.error?.message || `HTTP ${res.status}`;
  if (res.status === 429) {
    // "limit: 0" means this model has no free quota at all: switch to the next model.
    if (/limit:\s*0\b/.test(message)) {
      await dropModel(model, settings);
      throw new AIError(`${model} isn't free on your key; switched to another Flash model.`, true, 1000);
    }
    if (/per ?day|PerDay|daily/i.test(JSON.stringify(data))) throw new LimitError("Google's free daily limit for Gemini is used up. Work continues tomorrow.");
    const delay = data?.error?.details?.find((d: any) => d.retryDelay)?.retryDelay;
    throw new AIError('Gemini is busy (free-tier rate limit).', true, (parseFloat(delay) || 30) * 1000);
  }
  if (res.status === 400 && /api key/i.test(message)) throw new AIError('Your Gemini key was rejected. Check it in Settings → AI.');
  if (res.status === 403) throw new AIError(`Gemini refused the key: ${message}`);
  if (res.status === 404) {
    await dropModel(model, settings);
    throw new AIError(`${model} is no longer available; switched model.`, true, 1000);
  }
  if (res.status >= 500) throw new AIError(`Gemini error ${res.status}.`, true, 20_000);
  throw new AIError(`Gemini error ${res.status}: ${message}`);
}

// ── Models ──────────────────────────────────────────────

/** Check a key and choose models for it. Throws if the key doesn't work. */
export async function modelsForKey(key: string) {
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AIError(`That key didn't work: ${data?.error?.message || res.status}`);
  const names = (data.models ?? [])
    .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m: any) => String(m.name).replace(/^models\//, ''));
  const picked = pickModels(names);
  if (!picked.standard) throw new AIError('No free Gemini Flash model is available for this key.');
  return picked;
}

async function dropModel(model: string, settings: Settings) {
  const rest = (settings.models.candidates ?? []).filter((m: string) => m !== model);
  const picked = pickModels(rest);
  if (!picked.standard) throw new AIError('None of the Gemini models on your key have free quota left.');
  await updateSettings({ models: picked });
}

// ── Demo mode ───────────────────────────────────────────

async function simulate(demo?: AskOptions['demo']) {
  await sleep(1500 + Math.random() * 2000);
  const out = demo ? demo() : { text: '(demo output)' };
  return { text: out.text ?? '', json: out.json ?? null, sources: [], model: 'demo', requests: 0 };
}
