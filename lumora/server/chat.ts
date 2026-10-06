// The chat engine: one model step per HTTP request, streamed as NDJSON.
//
// The browser drives the agent loop (step → tools → step …). Each request performs a single model call
// plus any server-side tool executions, which keeps every invocation well within Netlify's function
// time limit and lets client-side tools (sandboxed code, memory) run in the browser with user consent.

import { z } from 'zod';
import { CLIENT_TOOLS, MODES } from '../shared/modes';
import { routeRequest, textOf } from '../shared/router';
import type {
  ApiTurn,
  BuiltInModeId,
  ChatRequestBody,
  CustomModeDef,
  ModeId,
  StreamEvent,
  ToolCall,
  ToolName,
  ToolResult,
  UsageInfo,
} from '../shared/types';
import { requireUser } from './auth';
import { env } from './env';
import { assertSameOrigin, errorResponse, FRIENDLY, HttpError, json, readJson } from './http';
import { checkQuota, recordUsage } from './limits';
import { logEvent } from './logger';
import { buildSystemPrompt } from './prompt';
import { getProvider, getProviders, resolveCandidates } from './providers/registry';
import { ProviderError, type ProviderEvent } from './providers/types';
import { TOOLS, toolAvailable } from './tools';
import { ToolInputError, type ToolContext } from './tools/types';

// ------------------------------------------------------------------------------------------------
// Input validation

const TOOL_NAMES = ['web_search', 'read_url', 'calculator', 'datetime', 'weather', 'json_tool', 'data_analysis', 'run_code', 'remember'] as const;

const partSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(400_000) }),
  z.object({
    type: z.literal('image'),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    data: z.string().max(6_000_000).regex(/^[A-Za-z0-9+/=]+$/),
    name: z.string().max(300).optional(),
  }),
  z.object({ type: z.literal('file'), name: z.string().max(300), mime: z.string().max(200), text: z.string().max(2_000_000), truncated: z.boolean().optional() }),
]);

const toolCallSchema = z.object({
  id: z.string().max(200),
  name: z.string().max(100),
  args: z.record(z.string(), z.unknown()),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const turnSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), parts: z.array(partSchema).max(40) }),
  z.object({
    role: z.literal('assistant'),
    text: z.string().max(400_000),
    toolCalls: z.array(toolCallSchema).max(20).optional(),
    native: z.object({ provider: z.string(), model: z.string(), blocks: z.unknown() }).optional(),
  }),
  z.object({
    role: z.literal('tool'),
    results: z.array(z.object({ id: z.string().max(200), name: z.string().max(100), content: z.string().max(200_000), isError: z.boolean().optional() })).max(20),
  }),
]);

const customModeSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(80),
  description: z.string().max(500).optional(),
  instructions: z.string().max(8000),
  personality: z.string().max(1000).optional(),
  model: z.string().max(200).optional(),
  tier: z.enum(['auto', 'fast', 'balanced', 'powerful']).optional(),
  temperature: z.number().min(0).max(2).optional(),
  tools: z.array(z.enum(TOOL_NAMES)).max(20),
});

const bodySchema = z.object({
  turns: z.array(turnSchema).min(1).max(400),
  mode: z.string().max(120),
  model: z.string().max(200).optional(),
  tier: z.enum(['auto', 'fast', 'balanced', 'powerful']).optional(),
  customMode: customModeSchema.optional(),
  instructions: z
    .object({
      enabled: z.boolean(),
      name: z.string().max(100).optional(),
      responseStyle: z.string().max(1000).optional(),
      language: z.string().max(50).optional(),
      technicalLevel: z.string().max(300).optional(),
      personality: z.string().max(1000).optional(),
      about: z.string().max(3000).optional(),
      avoid: z.string().max(2000).optional(),
    })
    .optional(),
  projectInstructions: z.string().max(8000).optional(),
  memories: z.array(z.string().max(500)).max(200).optional(),
  memoryEnabled: z.boolean().optional(),
  tools: z.array(z.enum(TOOL_NAMES)).max(20).optional(),
  agent: z.boolean().optional(),
  language: z.string().max(50).optional(),
  timezone: z.string().max(80).optional(),
  step: z.number().int().min(0).max(50).optional(),
  sourceOffset: z.number().int().min(0).max(1000).optional(),
});

// ------------------------------------------------------------------------------------------------

const BUILT_IN = new Set<string>(Object.keys(MODES));

function lastUserTurn(turns: ApiTurn[]) {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role === 'user') return t;
  }
  return undefined;
}

function turnChars(t: ApiTurn): number {
  if (t.role === 'user') return t.parts.reduce((n, p) => n + (p.type === 'image' ? 1000 : p.type === 'file' ? p.text.length : p.text.length), 0);
  if (t.role === 'assistant') return t.text.length;
  return t.results.reduce((n, r) => n + r.content.length, 0);
}

async function llmRoute(text: string): Promise<{ mode: BuiltInModeId; tier: 'fast' | 'balanced' | 'powerful' } | null> {
  try {
    const [c] = await resolveCandidates({ tier: 'fast', needsVision: false, longContext: false });
    const p = c && getProvider(c.provider);
    if (!p || !c) return null;
    let out = '';
    for await (const ev of p.stream({
      model: c.model,
      system:
        'Classify the user request. Reply with JSON only: {"mode": one of general|coding|research|writing|study|creative|analysis|planner, "tier": one of fast|balanced|powerful}. Use "powerful" for complex reasoning, coding or long documents, "fast" for short simple questions.',
      turns: [{ role: 'user', parts: [{ type: 'text', text: text.slice(0, 4000) }] }],
      tools: [],
      maxTokens: 200,
      signal: AbortSignal.timeout(6000),
    })) {
      if (ev.type === 'text') out += ev.delta;
    }
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { mode?: string; tier?: string };
    if (!parsed.mode || !BUILT_IN.has(parsed.mode)) return null;
    const tier = parsed.tier === 'fast' || parsed.tier === 'powerful' ? parsed.tier : 'balanced';
    return { mode: parsed.mode as BuiltInModeId, tier };
  } catch {
    return null;
  }
}

async function runServerTool(call: ToolCall, ctx: ToolContext): Promise<{ result: ToolResult; ok: boolean; summary: string; sources?: { title: string; url: string; snippet?: string }[]; ms: number }> {
  const started = Date.now();
  const def = TOOLS[call.name as ToolName];
  try {
    if (!def?.run) throw new ToolInputError(`Unknown tool "${call.name}"`);
    if ('_invalid_json' in call.args) throw new ToolInputError('Tool arguments were not valid JSON');
    const out = await Promise.race([
      def.run(call.args, ctx),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Tool timed out after 20s')), 20_000)),
    ]);
    return { result: { id: call.id, name: call.name, content: out.content }, ok: true, summary: out.summary, sources: out.sources, ms: Date.now() - started };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const friendly = err instanceof ToolInputError ? msg : `Tool failed: ${msg}`;
    return { result: { id: call.id, name: call.name, content: `Error: ${friendly}`, isError: true }, ok: false, summary: friendly, ms: Date.now() - started };
  }
}

export async function handleChat(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: { code: 'bad_request', message: 'Method not allowed' } }, 405);
  let body: ChatRequestBody;
  let user;
  try {
    assertSameOrigin(req);
    user = await requireUser(req);
    const raw = await readJson<unknown>(req, env.maxRequestBytes);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, 'bad_request', FRIENDLY.bad_request);
    body = parsed.data as ChatRequestBody;
    if (!getProviders().length) throw new HttpError(503, 'no_provider', FRIENDLY.no_provider);
    const totalChars = body.turns.reduce((n, t) => n + turnChars(t), 0);
    if (totalChars > env.maxInputChars) throw new HttpError(413, 'too_large', FRIENDLY.too_large);
    await checkQuota(user.id);
  } catch (err) {
    return errorResponse(err);
  }

  const step = body.step ?? 0;
  const lastUser = lastUserTurn(body.turns);
  const historyChars = body.turns.reduce((n, t) => n + turnChars(t), 0);
  const hasImages = body.turns.some((t) => t.role === 'user' && t.parts.some((p) => p.type === 'image'));

  // ---- Mode resolution ----------------------------------------------------------------------
  let modeKind: BuiltInModeId | 'custom' = 'general';
  let customMode: CustomModeDef | undefined;
  let routedBy: 'user' | 'auto' = 'user';
  let reason: string | undefined;
  const route = routeRequest(lastUser?.parts ?? [], historyChars - (lastUser ? turnChars(lastUser) : 0));
  let tier = route.tier;

  if (body.mode === 'auto') {
    routedBy = 'auto';
    modeKind = route.mode;
    reason = route.reason;
    if (env.routerStrategy === 'llm' && route.confidence < 0.7 && step === 0) {
      const llm = await llmRoute(textOf(lastUser?.parts ?? []));
      if (llm) {
        modeKind = llm.mode;
        tier = llm.tier;
        reason = 'Classified by the router model';
      }
    }
  } else if (body.mode.startsWith('custom:')) {
    if (!body.customMode) return errorResponse(new HttpError(400, 'bad_request', 'Custom mode definition missing.'));
    modeKind = 'custom';
    customMode = body.customMode;
    if (customMode.tier && customMode.tier !== 'auto') tier = customMode.tier;
  } else if (BUILT_IN.has(body.mode)) {
    modeKind = body.mode as BuiltInModeId;
    tier = MODES[modeKind].tier === 'powerful' && route.tier === 'fast' ? 'balanced' : MODES[modeKind].tier;
    if (route.tier === 'powerful') tier = 'powerful';
  }
  if (body.tier && body.tier !== 'auto') tier = body.tier;

  const modeId: ModeId = modeKind === 'custom' ? (body.mode as ModeId) : modeKind;
  const modeLabel = modeKind === 'custom' ? (customMode?.name ?? 'Custom') : MODES[modeKind].label;

  // ---- Tools --------------------------------------------------------------------------------
  let toolNames: ToolName[] = body.tools ?? (customMode ? customMode.tools : MODES[modeKind as BuiltInModeId].tools);
  if (body.agent) toolNames = [...new Set<ToolName>([...toolNames, 'web_search', 'read_url', 'calculator', 'datetime', 'run_code', 'data_analysis'])];
  toolNames = toolNames.filter((t) => t !== 'remember');
  if (body.memoryEnabled) toolNames.push('remember');
  toolNames = toolNames.filter(toolAvailable);
  const maxSteps = body.agent ? env.maxAgentSteps : 5;
  const finalStep = step >= maxSteps;
  const historyHasTools = body.turns.some((t) => t.role === 'tool' || (t.role === 'assistant' && t.toolCalls?.length));
  const offeredTools = finalStep && !historyHasTools ? [] : toolNames;

  const system = buildSystemPrompt({ body, mode: modeKind, customMode, tools: finalStep ? [] : toolNames, finalStep });
  const temperature = customMode?.temperature ?? (modeKind !== 'custom' ? MODES[modeKind].temperature : undefined);

  // ---- Model candidates ----------------------------------------------------------------------
  const explicit = body.model ?? (customMode?.model || undefined);
  const candidates = await resolveCandidates({ explicit, tier, needsVision: hasImages, longContext: route.longContext });
  if (!candidates.length) return errorResponse(new HttpError(503, 'no_provider', FRIENDLY.no_provider));
  // Images need a vision-capable model: move a vision model to the front if the first isn't one.
  if (hasImages && !candidates[0].vision) {
    const v = candidates.findIndex((c) => c.vision);
    if (v > 0) {
      const [c] = candidates.splice(v, 1);
      candidates.unshift(c);
      reason = `${reason ? reason + '; ' : ''}switched to a vision-capable model`;
    }
  }

  const files = new Map<string, string>();
  for (const t of body.turns) if (t.role === 'user') for (const p of t.parts) if (p.type === 'file') files.set(p.name, p.text);

  const encoder = new TextEncoder();
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(env.requestTimeoutMs)]);
  const userId = user.id;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (ev: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
        } catch {
          /* client went away */
        }
      };
      const started = Date.now();
      let fallbackFrom: string | undefined;
      let lastError: ProviderError | undefined;

      for (const cand of candidates) {
        const adapter = getProvider(cand.provider)!;
        write({ type: 'meta', mode: modeId, modeLabel, provider: cand.provider, model: cand.model, routedBy, reason, fallbackFrom });
        let streamed = false;
        try {
          let doneEv: Extract<ProviderEvent, { type: 'done' }> | undefined;
          for await (const ev of adapter.stream({
            model: cand.model,
            system,
            turns: body.turns,
            tools: offeredTools.map((t) => TOOLS[t].spec),
            temperature,
            maxTokens: env.maxOutputTokens,
            signal,
          })) {
            if (ev.type === 'text') {
              streamed = true;
              write({ type: 'text', delta: ev.delta });
            } else doneEv = ev;
          }
          if (!doneEv) throw new ProviderError('provider_error', 'stream ended without completion', undefined, true);

          const usage: UsageInfo = doneEv.usage;
          write({ type: 'usage', usage });
          await recordUsage(userId, usage.inputTokens ?? 0, usage.outputTokens ?? 0).catch(() => {});
          void logEvent({
            kind: 'request',
            user: userId,
            provider: cand.provider,
            model: cand.model,
            mode: modeId,
            latencyMs: Date.now() - started,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            ok: true,
          });

          let text = doneEv.text;
          if (doneEv.stopReason === 'refusal' && !text.trim()) {
            text = 'The model declined to respond to this request.';
            write({ type: 'text', delta: text });
          }

          // Drop tool calls we must not run (truncated input or step limit reached).
          let calls = doneEv.toolCalls;
          let native = doneEv.native;
          if (calls.length && (doneEv.stopReason === 'max_tokens' || finalStep || !offeredTools.length)) {
            calls = [];
            native = undefined;
            if (!text.trim()) {
              text = 'I reached the tool-use limit for this answer. Ask me to continue if you need more.';
              write({ type: 'text', delta: text });
            }
          }
          const assistantTurn: ApiTurn = { role: 'assistant', text, ...(calls.length ? { toolCalls: calls } : {}), ...(native ? { native } : {}) };

          if (!calls.length) {
            write({ type: 'done', stopReason: doneEv.stopReason, turns: [assistantTurn], next: 'stop' });
            controller.close();
            return;
          }

          const ctx: ToolContext = { timezone: body.timezone || 'UTC', files, sourceOffset: body.sourceOffset ?? 0, signal };
          const serverCalls = calls.filter((c) => !CLIENT_TOOLS.includes(c.name as ToolName) || !offeredTools.includes(c.name as ToolName));
          const clientCalls = calls.filter((c) => CLIENT_TOOLS.includes(c.name as ToolName) && offeredTools.includes(c.name as ToolName));
          for (const c of calls) write({ type: 'tool_call', call: c, client: clientCalls.includes(c) });

          // Server tools run in parallel; offered-ness is enforced (unknown tools return an error result).
          const results = await Promise.all(
            serverCalls.map(async (c) => {
              const r = offeredTools.includes(c.name as ToolName)
                ? await runServerTool(c, ctx)
                : { result: { id: c.id, name: c.name, content: `Error: tool "${c.name}" is not available`, isError: true }, ok: false, summary: 'Tool not available', ms: 0 };
              write({ type: 'tool_result', id: c.id, name: c.name, ok: r.ok, summary: r.summary, sources: r.sources, durationMs: r.ms });
              if (!r.ok) void logEvent({ kind: 'tool', user: userId, tool: c.name, ok: false, detail: r.summary });
              return r.result;
            }),
          );

          if (clientCalls.length) {
            write({ type: 'done', stopReason: 'tool_use', turns: [assistantTurn], next: 'client_tools', pendingClientCalls: clientCalls, serverResults: results });
          } else {
            write({ type: 'done', stopReason: 'tool_use', turns: [assistantTurn, { role: 'tool', results }], next: 'continue' });
          }
          controller.close();
          return;
        } catch (err) {
          const e = err instanceof ProviderError ? err : new ProviderError('provider_error', String(err), undefined, true);
          lastError = e;
          void logEvent({ kind: 'error', user: userId, provider: cand.provider, model: cand.model, code: e.code, detail: e.message, latencyMs: Date.now() - started });
          const canFallback = !streamed && !req.signal.aborted && e.code !== 'too_large';
          if (canFallback) {
            fallbackFrom = `${cand.provider}:${cand.model}`;
            continue;
          }
          break;
        }
      }

      const code = req.signal.aborted ? 'timeout' : (lastError?.code ?? 'provider_error');
      write({
        type: 'error',
        code,
        message: code === 'bad_request' ? 'The AI provider could not process this request. Try another model or remove attachments.' : FRIENDLY[code],
        retryable: lastError?.retryable ?? true,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
    },
  });
}
