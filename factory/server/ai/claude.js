// The only place that talks to Claude.
//
// Three tiers keep costs down:
//   fast      Haiku  — planning, checking, briefings, small skills
//   standard  Sonnet — most worker tasks, web research
//   strong    Opus   — only when the manager marks a task as complex
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { assertCanSpend, recordSpend } from '../core/budget.js';

// USD per million tokens [input, output]. Unknown models are priced like the strongest tier.
const PRICES = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
};
const WEB_SEARCH_USD = 0.01; // per search
const EFFORT = { fast: 'low', standard: 'medium', strong: 'high' };
const WEB_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 3 };

/** 'live' (API key present), 'demo' (simulated) or 'offline' (cannot run work). */
export function aiMode() {
  if (config.demo) return 'demo';
  return config.hasKey ? 'live' : 'offline';
}

export class AIError extends Error {
  constructor(message, retryable) {
    super(message);
    this.name = 'AIError';
    this.retryable = retryable;
  }
}

let client;
const getClient = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 5 * 60_000 }));

/**
 * Ask Claude once and return { text, json, sources, costUsd, model }.
 *   schema    JSON schema → structured output, parsed into `json`
 *   web       allow up to 3 web searches (forces at least the standard tier)
 *   demo()    returns simulated { text, json } when running in demo mode
 */
export async function ask({ tier = 'fast', system, prompt, schema, web = false, maxTokens = 4000, signal, demo }) {
  if (aiMode() === 'demo') return simulate(demo, signal);
  if (aiMode() === 'offline') throw new AIError('No ANTHROPIC_API_KEY configured on the server.', false);

  assertCanSpend();
  if (web && tier === 'fast') tier = 'standard'; // Haiku has no dynamic web search
  const model = config.models[tier];

  const messages = [{ role: 'user', content: prompt }];
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: { effort: EFFORT[tier], ...(schema && { format: { type: 'json_schema', schema } }) },
    ...(web && { tools: [WEB_TOOL] }),
    // If a model declines for policy reasons, the API retries on its recommended fallback.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };

  let res;
  let costUsd = 0;
  try {
    // A long web-research turn can pause; send it back so the server continues (max 3 times).
    for (let turn = 0; turn < 3; turn++) {
      res = await getClient().beta.messages.create(params, { signal });
      costUsd += cost(res);
      if (res.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: res.content });
    }
  } catch (err) {
    throw toAIError(err);
  } finally {
    if (costUsd) recordSpend(costUsd);
  }

  if (res.stop_reason === 'refusal') throw new AIError('Claude declined this request.', false);
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (res.stop_reason === 'max_tokens' && schema) throw new AIError('Response was cut off before it finished.', true);

  return { text, json: schema ? JSON.parse(text) : null, sources: sourcesOf(res), costUsd, model: res.model };
}

function cost(res) {
  const [pin, pout] = PRICES[res.model] || PRICES[config.models.strong] || [5, 25];
  const u = res.usage || {};
  const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
  const searches = u.server_tool_use?.web_search_requests || 0;
  return (input * pin + (u.output_tokens || 0) * pout) / 1e6 + searches * WEB_SEARCH_USD;
}

function sourcesOf(res) {
  const seen = new Map();
  for (const block of res.content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r.url && !seen.has(r.url)) seen.set(r.url, r.title || r.url);
    }
  }
  return [...seen].slice(0, 6).map(([url, title]) => ({ url, title }));
}

function toAIError(err) {
  if (err instanceof Anthropic.APIUserAbortError) return new AIError('Cancelled.', false);
  if (err instanceof Anthropic.AuthenticationError) return new AIError('The API key was rejected.', false);
  if (err instanceof Anthropic.RateLimitError) return new AIError('Rate limited by the API.', true);
  if (err instanceof Anthropic.APIConnectionError) return new AIError('Could not reach the Claude API.', true);
  if (err instanceof Anthropic.InternalServerError) return new AIError(`Claude API error ${err.status}.`, true);
  if (err instanceof Anthropic.APIError) return new AIError(`Claude API error ${err.status}: ${err.message}`, (err.status ?? 500) >= 500);
  return err;
}

// ── Demo mode: simulated, clearly-labelled output so the factory can be explored without a key ──

async function simulate(demo, signal) {
  await new Promise((resolve, reject) => {
    const t = setTimeout(resolve, config.demoDelayMs * (0.6 + Math.random() * 0.8));
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new AIError('Cancelled.', false));
    });
  });
  const out = demo ? demo() : { text: '(demo output)' };
  return { text: out.text ?? '', json: out.json ?? null, sources: [], costUsd: 0, model: 'demo' };
}
