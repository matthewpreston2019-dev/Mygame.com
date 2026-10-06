import Anthropic from '@anthropic-ai/sdk';
import type { ApiTurn, ModelInfo, ToolCall } from '../../shared/types';
import { fileToText, ProviderError, type ProviderAdapter, type ProviderEvent, type ProviderRequest } from './types';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Models that rejected `temperature` (newer Claude models removed sampling parameters). */
const noTemperature = new Set<string>();

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'tool_call';

export function toAnthropicMessages(turns: ApiTurn[], model: string): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  const push = (role: 'user' | 'assistant', blocks: Anthropic.ContentBlockParam[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) {
      (last.content as Anthropic.ContentBlockParam[]).push(...blocks);
    } else {
      out.push({ role, content: blocks });
    }
  };

  for (const t of turns) {
    if (t.role === 'user') {
      const blocks: Anthropic.ContentBlockParam[] = [];
      for (const p of t.parts) {
        if (p.type === 'image' && IMAGE_TYPES.has(p.mediaType)) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: p.mediaType as 'image/png', data: p.data },
          });
        } else if (p.type === 'file') {
          blocks.push({ type: 'text', text: fileToText(p) });
        } else if (p.type === 'text' && p.text.trim()) {
          blocks.push({ type: 'text', text: p.text });
        }
      }
      push('user', blocks.length ? blocks : [{ type: 'text', text: '(empty message)' }]);
    } else if (t.role === 'assistant') {
      if (t.native && t.native.provider === 'anthropic' && t.native.model === model && Array.isArray(t.native.blocks)) {
        // Same model continuing: replay the exact content (incl. thinking blocks and signatures).
        push('assistant', t.native.blocks as Anthropic.ContentBlockParam[]);
        continue;
      }
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (t.text.trim()) blocks.push({ type: 'text', text: t.text });
      for (const c of t.toolCalls ?? []) blocks.push({ type: 'tool_use', id: safeId(c.id), name: c.name, input: c.args });
      push('assistant', blocks.length ? blocks : [{ type: 'text', text: '(no response)' }]);
    } else {
      push(
        'user',
        t.results.map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: safeId(r.id),
          content: r.content,
          is_error: r.isError || undefined,
        })),
      );
    }
  }
  return out;
}

function mapError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('timeout', 'anthropic timeout', undefined, true);
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError('timeout', 'aborted', undefined, false);
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError('provider_error', `anthropic connection: ${err.message}`, undefined, true);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new ProviderError('provider_auth', `anthropic: ${err.message}`, err.status);
  if (err instanceof Anthropic.NotFoundError) return new ProviderError('model_not_found', `anthropic: ${err.message}`, 404);
  if (err instanceof Anthropic.RateLimitError) return new ProviderError('provider_error', `anthropic rate limit: ${err.message}`, 429, true);
  if (err instanceof Anthropic.BadRequestError) return new ProviderError('bad_request', `anthropic: ${err.message}`, 400);
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 500;
    return new ProviderError('provider_error', `anthropic ${status}: ${err.message}`, status, status >= 500 || status === 429);
  }
  return new ProviderError('provider_error', `anthropic: ${String(err)}`, undefined, true);
}

export function createAnthropic(apiKey: string): ProviderAdapter {
  const client = new Anthropic({ apiKey, maxRetries: 1 });

  return {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',

    async listModels(): Promise<ModelInfo[]> {
      const models: ModelInfo[] = [];
      for await (const m of client.models.list({ limit: 100 })) {
        models.push({
          id: `anthropic:${m.id}`,
          provider: 'anthropic',
          model: m.id,
          label: m.display_name || m.id,
          vision: m.capabilities ? !!m.capabilities.image_input?.supported : true,
          contextWindow: m.max_input_tokens ?? undefined,
          tools: true,
        });
      }
      return models;
    },

    async *stream(req: ProviderRequest): AsyncGenerator<ProviderEvent> {
      const run = (withTemperature: boolean) =>
        client.messages.stream(
          {
            model: req.model,
            max_tokens: req.maxTokens,
            system: req.system,
            messages: toAnthropicMessages(req.turns, req.model),
            ...(req.tools.length
              ? {
                  tools: req.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    input_schema: t.parameters as Anthropic.Tool.InputSchema,
                  })),
                }
              : {}),
            ...(withTemperature && req.temperature !== undefined ? { temperature: req.temperature } : {}),
          },
          { signal: req.signal },
        );

      let stream = run(!noTemperature.has(req.model));
      let started = false;
      try {
        for (;;) {
          try {
            for await (const ev of stream) {
              if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
                started = true;
                yield { type: 'text', delta: ev.delta.text };
              }
            }
            break;
          } catch (err) {
            // Newer Claude models reject sampling parameters: retry once without temperature.
            if (!started && err instanceof Anthropic.BadRequestError && /temperature|sampling/i.test(err.message) && !noTemperature.has(req.model)) {
              noTemperature.add(req.model);
              stream = run(false);
              continue;
            }
            throw err;
          }
        }
        const msg = await stream.finalMessage();
        const toolCalls: ToolCall[] = [];
        let text = '';
        for (const b of msg.content) {
          if (b.type === 'text') text += b.text;
          else if (b.type === 'tool_use') toolCalls.push({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> });
        }
        const stop = msg.stop_reason;
        yield {
          type: 'done',
          text,
          toolCalls,
          stopReason: stop === 'tool_use' ? 'tool_use' : stop === 'max_tokens' ? 'max_tokens' : stop === 'refusal' ? 'refusal' : 'end',
          usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
          native: { provider: 'anthropic', model: req.model, blocks: msg.content },
        };
      } catch (err) {
        throw mapError(err);
      }
    },
  };
}
