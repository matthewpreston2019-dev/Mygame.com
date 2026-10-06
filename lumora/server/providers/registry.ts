// Builds provider adapters from environment variables, discovers models and resolves tiers.

import type { ModelInfo, ModelTier, ProviderInfo, TierMap } from '../../shared/types';
import { env } from '../env';
import { createAnthropic } from './anthropic';
import { createGemini } from './gemini';
import { createOpenAICompatible } from './openaiCompatible';
import { versionScore, type ProviderAdapter } from './types';

const DEFAULT_ORDER = ['anthropic', 'openai', 'gemini', 'openrouter', 'groq', 'custom', 'ollama'];

let cachedProviders: { key: string; list: ProviderAdapter[] } | null = null;

function configKey(): string {
  return [
    env.anthropicKey,
    env.openaiKey,
    env.geminiKey,
    env.openrouterKey,
    env.groqKey,
    env.ollamaBaseUrl,
    env.customBaseUrl,
    env.providerPriority.join(','),
  ]
    .map((v) => (v ? v.length : 0))
    .join('|');
}

const OPENAI_CHAT = (id: string) =>
  /^(gpt-|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|codex|computer-use|dall-e|whisper|babbage|davinci)/.test(id);

export function getProviders(): ProviderAdapter[] {
  const key = configKey();
  if (cachedProviders?.key === key) return cachedProviders.list;
  const list: ProviderAdapter[] = [];
  if (env.anthropicKey) list.push(createAnthropic(env.anthropicKey));
  if (env.openaiKey)
    list.push(
      createOpenAICompatible({
        id: 'openai',
        label: 'OpenAI',
        baseUrl: env.openaiBaseUrl,
        apiKey: env.openaiKey,
        maxTokensField: 'max_completion_tokens',
        includeUsage: true,
        filterModel: OPENAI_CHAT,
      }),
    );
  if (env.geminiKey) list.push(createGemini(env.geminiKey));
  if (env.openrouterKey)
    list.push(
      createOpenAICompatible({
        id: 'openrouter',
        label: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: env.openrouterKey,
        includeUsage: true,
        extraHeaders: { 'HTTP-Referer': process.env.URL ?? 'https://lumora.local', 'X-Title': env.appName },
      }),
    );
  if (env.groqKey)
    list.push(
      createOpenAICompatible({
        id: 'groq',
        label: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: env.groqKey,
        filterModel: (id) => !/whisper|tts|guard|playai|orpheus|prompt-guard/.test(id),
      }),
    );
  if (env.customBaseUrl)
    list.push(
      createOpenAICompatible({
        id: 'custom',
        label: env.customName,
        baseUrl: env.customBaseUrl,
        apiKey: env.customKey,
        staticModels: env.customModels,
      }),
    );
  if (env.ollamaBaseUrl)
    list.push(
      createOpenAICompatible({
        id: 'ollama',
        label: 'Ollama (local)',
        baseUrl: env.ollamaBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1',
      }),
    );
  const order = env.providerPriority.length ? env.providerPriority : DEFAULT_ORDER;
  list.sort((a, b) => rank(order, a.id) - rank(order, b.id));
  cachedProviders = { key, list };
  return list;
}

const rank = (order: string[], id: string) => {
  const i = order.indexOf(id);
  return i === -1 ? 99 : i;
};

export function providerInfo(): ProviderInfo[] {
  return getProviders().map((p) => ({ id: p.id, label: p.label, kind: p.kind }));
}

export function getProvider(id: string): ProviderAdapter | undefined {
  return getProviders().find((p) => p.id === id);
}

// ------------------------------------------------------------------------------------------------
// Model discovery (cached per function instance)

/** Used only when a provider's model list cannot be fetched. Overridable via MODEL_* variables. */
const FALLBACK_MODELS: Record<string, { fast: string; balanced: string; powerful: string }> = {
  anthropic: { fast: 'claude-haiku-4-5', balanced: 'claude-sonnet-5-5', powerful: 'claude-opus-5-5' },
  openai: { fast: 'gpt-5-mini', balanced: 'gpt-5-mini', powerful: 'gpt-5' },
  gemini: { fast: 'gemini-flash-lite-latest', balanced: 'gemini-flash-latest', powerful: 'gemini-pro-latest' },
  openrouter: { fast: 'openrouter/auto', balanced: 'openrouter/auto', powerful: 'openrouter/auto' },
};

const modelCache = new Map<string, { at: number; models: ModelInfo[]; error?: string }>();
const MODEL_TTL = 10 * 60_000;

export async function listModels(providerId: string, force = false): Promise<{ models: ModelInfo[]; error?: string }> {
  const p = getProvider(providerId);
  if (!p) return { models: [], error: 'not configured' };
  const hit = modelCache.get(providerId);
  if (!force && hit && Date.now() - hit.at < MODEL_TTL) return hit;
  try {
    const models = await p.listModels();
    const entry = { at: Date.now(), models };
    modelCache.set(providerId, entry);
    return entry;
  } catch (err) {
    const fb = FALLBACK_MODELS[providerId];
    const models: ModelInfo[] = fb
      ? [...new Set(Object.values(fb))].map((m) => ({ id: `${providerId}:${m}`, provider: providerId, model: m, label: m, vision: true, tools: true }))
      : [];
    const entry = { at: Date.now() - MODEL_TTL + 60_000, models, error: err instanceof Error ? err.message : String(err) };
    modelCache.set(providerId, entry);
    return entry;
  }
}

export async function listAllModels(): Promise<ModelInfo[]> {
  const results = await Promise.all(getProviders().map((p) => listModels(p.id)));
  return results.flatMap((r) => r.models);
}

// ------------------------------------------------------------------------------------------------
// Tier resolution

type Tier = Exclude<ModelTier, 'auto'>;

function pick(models: ModelInfo[], re: RegExp, exclude?: RegExp): ModelInfo | undefined {
  const matches = models.filter((m) => re.test(m.model) && !(exclude && exclude.test(m.model)));
  // Prefer stable over preview/experimental, then the highest version. Stable sort keeps API order (newest first).
  return matches
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const pa = /preview|exp|beta/i.test(a.m.model) ? 1 : 0;
      const pb = /preview|exp|beta/i.test(b.m.model) ? 1 : 0;
      if (pa !== pb) return pa - pb;
      const v = versionScore(b.m.model) - versionScore(a.m.model);
      return v !== 0 ? v : a.i - b.i;
    })[0]?.m;
}

/** Chooses a model for a tier from a provider's live model list using naming conventions. */
export function tierModelFor(providerId: string, models: ModelInfo[], tier: Tier): ModelInfo | undefined {
  const fb = FALLBACK_MODELS[providerId];
  const byName = (name?: string) => (name ? models.find((m) => m.model === name) : undefined);
  let found: ModelInfo | undefined;
  switch (providerId) {
    case 'anthropic':
      found =
        tier === 'fast' ? pick(models, /haiku/) : tier === 'balanced' ? pick(models, /sonnet/) : pick(models, /opus/);
      break;
    case 'openai':
      found =
        tier === 'fast'
          ? (pick(models, /^gpt-[\d.]+-nano$/) ?? pick(models, /^gpt-[\d.]+-mini$/))
          : tier === 'balanced'
            ? pick(models, /^gpt-[\d.]+-mini$/)
            : pick(models, /^gpt-\d+(\.\d+)?$/);
      break;
    case 'gemini':
      found =
        tier === 'fast'
          ? pick(models, /^gemini-[\d.]+-flash-lite/)
          : tier === 'balanced'
            ? pick(models, /^gemini-[\d.]+-flash/, /lite|thinking/)
            : pick(models, /^gemini-[\d.]+-pro/);
      break;
    case 'groq':
      found =
        tier === 'fast'
          ? (pick(models, /instant|8b/) ?? pick(models, /20b/))
          : (pick(models, /120b/) ?? pick(models, /70b|versatile/));
      break;
    default:
      break;
  }
  return found ?? byName(fb?.[tier]) ?? (fb ? { id: `${providerId}:${fb[tier]}`, provider: providerId, model: fb[tier], label: fb[tier], vision: true } : models[0]);
}

export interface Candidate {
  provider: string;
  model: string;
  vision: boolean;
  contextWindow?: number;
}

function parseRef(ref: string): { provider: string; model: string } | null {
  const i = ref.indexOf(':');
  if (i <= 0) return null;
  return { provider: ref.slice(0, i), model: ref.slice(i + 1) };
}

/**
 * Returns an ordered list of candidates: the preferred model first, then equivalents on other
 * providers (fallback). Honors MODEL_* overrides.
 */
export async function resolveCandidates(opts: {
  explicit?: string;
  tier: Tier;
  needsVision: boolean;
  longContext: boolean;
}): Promise<Candidate[]> {
  const providers = getProviders();
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (c: Candidate | undefined) => {
    if (!c || !getProvider(c.provider)) return;
    const k = `${c.provider}:${c.model}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };
  const info = async (ref: { provider: string; model: string }): Promise<Candidate> => {
    const { models } = await listModels(ref.provider);
    const m = models.find((x) => x.model === ref.model);
    return { ...ref, vision: m ? m.vision : true, contextWindow: m?.contextWindow };
  };

  if (opts.explicit) {
    const ref = parseRef(opts.explicit);
    if (ref) add(await info(ref));
  }

  const overrides = env.tierOverrides;
  const special = opts.needsVision ? overrides.vision : opts.longContext ? overrides.longContext : undefined;
  if (special) {
    const ref = parseRef(special);
    if (ref) add(await info(ref));
  }
  const tierOverride = overrides[opts.tier];
  if (tierOverride) {
    const ref = parseRef(tierOverride);
    if (ref) add(await info(ref));
  }

  for (const p of providers) {
    const { models } = await listModels(p.id);
    let m = tierModelFor(p.id, models, opts.tier);
    if (opts.needsVision && m && !m.vision) {
      m = tierModelFor(p.id, models.filter((x) => x.vision), opts.tier) ?? models.find((x) => x.vision);
    }
    if (opts.longContext) {
      const big = [...models].filter((x) => (x.contextWindow ?? 0) >= 200_000 && (!opts.needsVision || x.vision));
      if (m && (m.contextWindow ?? 0) < 200_000 && big.length) m = tierModelFor(p.id, big, opts.tier) ?? big[0];
    }
    if (m) add({ provider: m.provider, model: m.model, vision: m.vision, contextWindow: m.contextWindow });
  }

  // When a specific model was requested, only keep fallbacks if fallback is enabled.
  if (!env.fallbackEnabled) return out.slice(0, 1);
  return out;
}

export async function currentTierMap(): Promise<TierMap> {
  const map: TierMap = {};
  for (const tier of ['fast', 'balanced', 'powerful'] as Tier[]) {
    const [c] = await resolveCandidates({ tier, needsVision: false, longContext: false });
    if (c) map[tier] = `${c.provider}:${c.model}`;
  }
  const [v] = await resolveCandidates({ tier: 'balanced', needsVision: true, longContext: false });
  if (v) map.vision = `${v.provider}:${v.model}`;
  const [l] = await resolveCandidates({ tier: 'balanced', needsVision: false, longContext: true });
  if (l) map.longContext = `${l.provider}:${l.model}`;
  return map;
}
