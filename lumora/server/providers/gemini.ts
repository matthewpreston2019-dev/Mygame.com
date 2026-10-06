// Google Gemini (Generative Language API) adapter using REST + SSE streaming.

import type { ApiTurn, ModelInfo, ToolCall } from '../../shared/types';
import { readSSE } from './sse';
import { fileToText, ProviderError, providerErrorFromStatus, type ProviderAdapter, type ProviderEvent, type ProviderRequest } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export function toGeminiContents(turns: ApiTurn[], model: string): GeminiContent[] {
  const out: GeminiContent[] = [];
  const push = (role: GeminiContent['role'], parts: GeminiPart[]) => {
    if (!parts.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  };
  for (const t of turns) {
    if (t.role === 'user') {
      const parts: GeminiPart[] = [];
      for (const p of t.parts) {
        if (p.type === 'text' && p.text.trim()) parts.push({ text: p.text });
        else if (p.type === 'file') parts.push({ text: fileToText(p) });
        else if (p.type === 'image') parts.push({ inlineData: { mimeType: p.mediaType, data: p.data } });
      }
      push('user', parts.length ? parts : [{ text: '(empty message)' }]);
    } else if (t.role === 'assistant') {
      if (t.native?.provider === 'gemini' && t.native.model === model && Array.isArray(t.native.blocks)) {
        push('model', t.native.blocks as GeminiPart[]);
        continue;
      }
      const parts: GeminiPart[] = [];
      if (t.text) parts.push({ text: t.text });
      for (const c of t.toolCalls ?? []) {
        const sig = typeof c.meta?.thoughtSignature === 'string' ? c.meta.thoughtSignature : undefined;
        parts.push({ functionCall: { name: c.name, args: c.args }, ...(sig ? { thoughtSignature: sig } : {}) });
      }
      push('model', parts.length ? parts : [{ text: '(no response)' }]);
    } else {
      push(
        'user',
        t.results.map((r) => ({
          functionResponse: { name: r.name, response: r.isError ? { error: r.content } : { content: r.content } },
        })),
      );
    }
  }
  return out;
}

export function createGemini(apiKey: string): ProviderAdapter {
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
  return {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',

    async listModels(): Promise<ModelInfo[]> {
      const res = await fetch(`${BASE}/models?pageSize=200`, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw providerErrorFromStatus(res.status, await res.text(), 'gemini');
      const data = (await res.json()) as {
        models?: { name: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }[];
      };
      return (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .filter((m) => /gemini|gemma/i.test(m.name) && !/embedding|aqa|imagen|veo|tts|image-generation|-image|native-audio|live|robotics|computer-use/i.test(m.name))
        .map((m) => {
          const id = m.name.replace(/^models\//, '');
          return {
            id: `gemini:${id}`,
            provider: 'gemini',
            model: id,
            label: m.displayName || id,
            vision: /gemini/i.test(id),
            contextWindow: m.inputTokenLimit,
            tools: /gemini/i.test(id),
          };
        });
    },

    async *stream(req: ProviderRequest): AsyncGenerator<ProviderEvent> {
      const body = {
        contents: toGeminiContents(req.turns, req.model),
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        ...(req.tools.length
          ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] }
          : {}),
        generationConfig: {
          maxOutputTokens: req.maxTokens,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
      };
      let res: Response;
      try {
        res = await fetch(`${BASE}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch (err) {
        if (req.signal.aborted) throw new ProviderError('timeout', 'gemini: aborted/timed out', undefined, true);
        throw new ProviderError('provider_error', `gemini network error: ${String(err)}`, undefined, true);
      }
      if (!res.ok || !res.body) throw providerErrorFromStatus(res.status, await res.text(), 'gemini');

      let text = '';
      let textSignature: string | undefined;
      let finish: string | undefined;
      let blocked = false;
      let usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      const callParts: GeminiPart[] = [];

      for await (const ev of readSSE(res.body, req.signal)) {
        let chunk: {
          candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          promptFeedback?: { blockReason?: string };
          error?: { message?: string; code?: number };
        };
        try {
          chunk = JSON.parse(ev.data);
        } catch {
          continue;
        }
        if (chunk.error) throw new ProviderError('provider_error', `gemini stream error: ${chunk.error.message}`, chunk.error.code, true);
        if (chunk.promptFeedback?.blockReason) blocked = true;
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
        const cand = chunk.candidates?.[0];
        if (cand?.finishReason) finish = cand.finishReason;
        for (const part of cand?.content?.parts ?? []) {
          if (part.thought) continue;
          if (part.functionCall) callParts.push(part);
          else if (typeof part.text === 'string') {
            if (part.thoughtSignature) textSignature = part.thoughtSignature;
            if (part.text) {
              text += part.text;
              yield { type: 'text', delta: part.text };
            }
          }
        }
      }

      const toolCalls: ToolCall[] = callParts.map((p, i) => ({
        id: p.functionCall!.id ?? `gemini_${Date.now()}_${i}`,
        name: p.functionCall!.name,
        args: p.functionCall!.args ?? {},
        ...(p.thoughtSignature ? { meta: { thoughtSignature: p.thoughtSignature } } : {}),
      }));
      const nativeParts: GeminiPart[] = [];
      if (text || textSignature) nativeParts.push({ text, ...(textSignature ? { thoughtSignature: textSignature } : {}) });
      nativeParts.push(...callParts);

      yield {
        type: 'done',
        text,
        toolCalls,
        stopReason: toolCalls.length
          ? 'tool_use'
          : finish === 'MAX_TOKENS'
            ? 'max_tokens'
            : blocked || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST'
              ? 'refusal'
              : 'end',
        usage: { inputTokens: usage?.promptTokenCount, outputTokens: usage?.candidatesTokenCount },
        native: nativeParts.length ? { provider: 'gemini', model: req.model, blocks: nativeParts } : undefined,
      };
    },
  };
}
