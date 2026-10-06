// Adapter for any OpenAI-compatible Chat Completions API: OpenAI, OpenRouter, Groq, Ollama,
// LM Studio, Together, Mistral, DeepSeek, vLLM, etc.

import type { ApiTurn, ModelInfo, ToolCall } from '../../shared/types';
import { readSSE } from './sse';
import {
  fileToText,
  guessVision,
  ProviderError,
  providerErrorFromStatus,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderRequest,
} from './types';

export interface OpenAICompatibleOptions {
  id: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  /** Use `max_completion_tokens` (OpenAI) instead of `max_tokens`. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  includeUsage?: boolean;
  /** Static model list used when the provider has no /models endpoint. */
  staticModels?: string[];
  filterModel?: (id: string) => boolean;
}

type OAIContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
type OAIMessage =
  | { role: 'system' | 'user'; content: OAIContent }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toOpenAIMessages(system: string, turns: ApiTurn[]): OAIMessage[] {
  const out: OAIMessage[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const t of turns) {
    if (t.role === 'user') {
      const parts: Exclude<OAIContent, string> = [];
      for (const p of t.parts) {
        if (p.type === 'text' && p.text.trim()) parts.push({ type: 'text', text: p.text });
        else if (p.type === 'file') parts.push({ type: 'text', text: fileToText(p) });
        else if (p.type === 'image') parts.push({ type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } });
      }
      const onlyText = parts.every((p) => p.type === 'text');
      out.push({
        role: 'user',
        content: onlyText ? parts.map((p) => (p as { text: string }).text).join('\n\n') || '(empty message)' : parts,
      });
    } else if (t.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: t.text || (t.toolCalls?.length ? null : '(no response)'),
        ...(t.toolCalls?.length
          ? {
              tool_calls: t.toolCalls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      for (const r of t.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    }
  }
  return out;
}

export function createOpenAICompatible(opts: OpenAICompatibleOptions): ProviderAdapter {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    ...opts.extraHeaders,
  });
  // Parameters a given model rejected; remembered per function instance.
  const quirks = new Map<string, Set<string>>();

  return {
    id: opts.id,
    label: opts.label,
    kind: 'openai-compatible',

    async listModels(): Promise<ModelInfo[]> {
      if (opts.staticModels?.length) {
        return opts.staticModels.map((m) => ({ id: `${opts.id}:${m}`, provider: opts.id, model: m, label: m, vision: guessVision(m), tools: true }));
      }
      const res = await fetch(`${base}/models`, { headers: headers(), signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw providerErrorFromStatus(res.status, await res.text(), opts.id);
      const data = (await res.json()) as {
        data?: {
          id: string;
          name?: string;
          context_length?: number;
          context_window?: number;
          architecture?: { input_modalities?: string[] };
          supported_parameters?: string[];
        }[];
      };
      return (data.data ?? [])
        .filter((m) => (opts.filterModel ? opts.filterModel(m.id) : true))
        .map((m) => ({
          id: `${opts.id}:${m.id}`,
          provider: opts.id,
          model: m.id,
          label: m.name || m.id,
          vision: m.architecture?.input_modalities ? m.architecture.input_modalities.includes('image') : guessVision(m.id),
          contextWindow: m.context_length ?? m.context_window,
          tools: m.supported_parameters ? m.supported_parameters.includes('tools') : true,
        }));
    },

    async *stream(req: ProviderRequest): AsyncGenerator<ProviderEvent> {
      const q = quirks.get(req.model) ?? new Set<string>();
      quirks.set(req.model, q);
      let res: Response | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const body: Record<string, unknown> = {
          model: req.model,
          messages: toOpenAIMessages(req.system, req.turns),
          stream: true,
        };
        const field = q.has('swap_max_tokens')
          ? opts.maxTokensField === 'max_completion_tokens'
            ? 'max_tokens'
            : 'max_completion_tokens'
          : (opts.maxTokensField ?? 'max_tokens');
        if (!q.has('max_tokens')) body[field] = req.maxTokens;
        if (opts.includeUsage && !q.has('stream_options')) body.stream_options = { include_usage: true };
        if (req.temperature !== undefined && !q.has('temperature')) body.temperature = req.temperature;
        if (req.tools.length && !q.has('tools')) {
          body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
        }
        try {
          res = await fetch(`${base}/chat/completions`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: req.signal });
        } catch (err) {
          if (req.signal.aborted) throw new ProviderError('timeout', `${opts.id}: request aborted/timed out`, undefined, true);
          throw new ProviderError('provider_error', `${opts.id} network error: ${String(err)}`, undefined, true);
        }
        if (res.ok) break;
        const text = await res.text();
        if (res.status === 400 || res.status === 404 || res.status === 422) {
          // Adapt to provider/model quirks and retry.
          const lower = text.toLowerCase();
          let adapted = false;
          if (lower.includes('temperature') && !q.has('temperature')) (q.add('temperature'), (adapted = true));
          else if (/max_completion_tokens|max_tokens/.test(lower) && !q.has('swap_max_tokens')) (q.add('swap_max_tokens'), (adapted = true));
          else if (lower.includes('stream_options') && !q.has('stream_options')) (q.add('stream_options'), (adapted = true));
          else if (/tool|function/.test(lower) && req.tools.length && !q.has('tools')) (q.add('tools'), (adapted = true));
          if (adapted) continue;
        }
        throw providerErrorFromStatus(res.status, text, opts.id);
      }
      if (!res || !res.ok || !res.body) throw new ProviderError('provider_error', `${opts.id}: no response body`, undefined, true);

      let text = '';
      let finish: string | null = null;
      let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
      const calls = new Map<number, { id: string; name: string; args: string }>();

      for await (const ev of readSSE(res.body, req.signal)) {
        if (ev.data === '[DONE]') break;
        let chunk: {
          error?: { message?: string; code?: number };
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          choices?: {
            delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] };
            finish_reason?: string | null;
          }[];
        };
        try {
          chunk = JSON.parse(ev.data);
        } catch {
          continue;
        }
        if (chunk.error) throw new ProviderError('provider_error', `${opts.id} stream error: ${chunk.error.message ?? 'unknown'}`, chunk.error.code, true);
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const d = choice.delta;
        if (d?.content) {
          text += d.content;
          yield { type: 'text', delta: d.content };
        }
        for (const tc of d?.tool_calls ?? []) {
          const i = tc.index ?? 0;
          const cur = calls.get(i) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(i, cur);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }

      const toolCalls: ToolCall[] = [...calls.values()]
        .filter((c) => c.name)
        .map((c, i) => {
          let args: Record<string, unknown> = {};
          try {
            args = c.args ? JSON.parse(c.args) : {};
          } catch {
            args = { _invalid_json: c.args.slice(0, 2000) };
          }
          return { id: c.id || `call_${Date.now()}_${i}`, name: c.name, args };
        });

      yield {
        type: 'done',
        text,
        toolCalls,
        stopReason: toolCalls.length ? 'tool_use' : finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : 'end',
        usage: { inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens },
      };
    },
  };
}
