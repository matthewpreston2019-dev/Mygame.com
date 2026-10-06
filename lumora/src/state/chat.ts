// Conversation state and the client-side agent loop.
//
// Each assistant answer may take several /api/chat steps: the server streams one model turn and runs
// server tools; the browser runs client tools (sandboxed code, memory) with permission, then calls the
// next step until the model is done or the step limit is reached.

import { create } from 'zustand';
import type { ApiTurn, ChatRequestBody, ContentPart, ModeId, Source, StreamEvent, ToolCall, ToolName, ToolResult } from '@shared/types';
import { data } from '@/data/store';
import type { Attachment, Conversation, Message, ModelChoice, ToolActivity } from '@/data/types';
import { ApiError } from '@/lib/api';
import { streamChat } from '@/lib/chatClient';
import { formatRunResult, runCode } from '@/lib/sandbox';
import { uid } from '@/lib/utils';
import { useApp } from './app';

export type PermissionDecision = 'once' | 'always' | 'deny';

interface ChatState {
  activeId: string | null;
  messages: Message[];
  loading: boolean;
  streamingId: string | null;
  mode: ModeId;
  model: ModelChoice;
  tools: ToolName[] | null;
  agent: boolean;
  permission: { messageId: string; call: ToolCall; resolve: (d: PermissionDecision) => void } | null;
  /** Called when an assistant message finishes (used by voice conversation). */
  onAssistantDone: ((m: Message) => void) | null;

  openConversation(id: string): Promise<void>;
  newChat(projectId?: string | null): void;
  send(text: string, attachments: Attachment[]): Promise<void>;
  regenerate(assistantId: string): Promise<void>;
  editAndResend(userId: string, text: string): Promise<void>;
  stop(): void;
  setMode(m: ModeId): void;
  setModel(m: ModelChoice): void;
  setTools(t: ToolName[] | null): void;
  setAgent(a: boolean): void;
  setOnAssistantDone(fn: ((m: Message) => void) | null): void;
}

let controller: AbortController | null = null;
const modelId = (m: ModelChoice) => (m.kind === 'model' ? m.id : undefined);
const alwaysAllowCode = new Set<string>(); // conversation ids

const MAX_IMAGE_MESSAGES = 2;
const PROJECT_FILES_BUDGET = 200_000;

function attachmentsToParts(atts: Attachment[] | undefined, keepImages: boolean): ContentPart[] {
  const parts: ContentPart[] = [];
  for (const a of atts ?? []) {
    if (a.kind === 'image') {
      if (keepImages && a.data) parts.push({ type: 'image', mediaType: a.mime, data: a.data, name: a.name });
      else parts.push({ type: 'text', text: `[Image "${a.name}" was shared earlier in the conversation]` });
    } else if (a.text !== undefined) {
      parts.push({ type: 'file', name: a.name, mime: a.mime, text: a.text, truncated: a.truncated });
    }
  }
  return parts;
}

/** Strips trailing tool calls that never got results (e.g. a stopped answer). */
function sanitizeTurns(turns: ApiTurn[]): ApiTurn[] {
  const out = [...turns];
  const last = out[out.length - 1];
  if (last?.role === 'assistant' && last.toolCalls?.length) out[out.length - 1] = { role: 'assistant', text: last.text };
  return out;
}

/** Converts stored messages to provider-neutral turns, keeping only recent images to bound request size. */
export function buildTurns(messages: Message[]): ApiTurn[] {
  const imageMsgIds = messages.filter((m) => m.role === 'user' && m.attachments?.some((a) => a.kind === 'image')).map((m) => m.id);
  const keep = new Set(imageMsgIds.slice(-MAX_IMAGE_MESSAGES));
  const turns: ApiTurn[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const parts: ContentPart[] = [...attachmentsToParts(m.attachments, keep.has(m.id))];
      if (m.content.trim()) parts.push({ type: 'text', text: m.content });
      turns.push({ role: 'user', parts: parts.length ? parts : [{ type: 'text', text: '(empty)' }] });
    } else if (m.turns?.length) {
      turns.push(...sanitizeTurns(m.turns));
    } else if (m.content.trim()) {
      turns.push({ role: 'assistant', text: m.content });
    }
  }
  return turns;
}

function titleFrom(text: string, atts: Attachment[]): string {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? '';
  const base = line || (atts[0] ? atts[0].name : 'New chat');
  return base.length > 60 ? base.slice(0, 57).trimEnd() + '…' : base;
}

export const useChat = create<ChatState>((set, get) => {
  const patchMessage = (id: string, fn: (m: Message) => Message) =>
    set({ messages: get().messages.map((m) => (m.id === id ? fn(m) : m)) });

  const persist = (id: string) => {
    const m = get().messages.find((x) => x.id === id);
    if (m) void data().saveMessage(m).catch(() => useApp.getState().toast('Could not save the message', { tone: 'error' }));
  };

  async function askPermission(messageId: string, call: ToolCall): Promise<PermissionDecision> {
    return new Promise((resolve) => set({ permission: { messageId, call, resolve: (d) => (set({ permission: null }), resolve(d)) } }));
  }

  async function runClientTool(messageId: string, conversationId: string, call: ToolCall): Promise<ToolResult> {
    const app = useApp.getState();
    const setAct = (patch: Partial<ToolActivity>) =>
      patchMessage(messageId, (m) => ({ ...m, tools: (m.tools ?? []).map((t) => (t.id === call.id ? { ...t, ...patch } : t)) }));

    if (call.name === 'remember') {
      const fact = typeof call.args.fact === 'string' ? call.args.fact.trim() : '';
      if (!fact || !app.settings.memoryEnabled) {
        setAct({ status: 'error', summary: 'Memory is disabled' });
        return { id: call.id, name: call.name, content: 'Memory is disabled by the user; nothing was saved.', isError: true };
      }
      const mem = await app.addMemory(fact, conversationId);
      setAct({ status: 'done', summary: `Remembered: ${fact}` });
      app.toast(`Saved to memory: “${fact}”`, { tone: 'success', action: { label: 'Undo', run: () => void useApp.getState().deleteMemory(mem.id) } });
      return { id: call.id, name: call.name, content: 'Saved to memory.' };
    }

    if (call.name === 'run_code') {
      const language = String(call.args.language ?? 'python');
      const code = String(call.args.code ?? '');
      let decision: PermissionDecision = app.settings.autoApproveCode || alwaysAllowCode.has(conversationId) ? 'once' : 'deny';
      if (decision !== 'once') {
        setAct({ status: 'awaiting', summary: 'Waiting for your permission' });
        decision = await askPermission(messageId, call);
      }
      if (decision === 'deny') {
        setAct({ status: 'denied', summary: 'You declined to run this code' });
        return { id: call.id, name: call.name, content: 'The user declined to run this code.', isError: true };
      }
      if (decision === 'always') alwaysAllowCode.add(conversationId);
      setAct({ status: 'running', summary: `Running ${language} in browser sandbox…` });
      const r = await runCode(language, code);
      const output = formatRunResult(r);
      setAct({ status: r.ok ? 'done' : 'error', summary: r.ok ? `Ran ${language} (${Math.round(r.durationMs)} ms)` : `${language} failed`, output, durationMs: r.durationMs });
      return { id: call.id, name: call.name, content: output, isError: !r.ok };
    }

    setAct({ status: 'error', summary: 'Unknown tool' });
    return { id: call.id, name: call.name, content: `Unknown client tool ${call.name}`, isError: true };
  }

  async function projectContext(conv: Conversation): Promise<{ instructions?: string; files: ContentPart[] }> {
    if (!conv.projectId) return { files: [] };
    const app = useApp.getState();
    const project = app.projects.find((p) => p.id === conv.projectId);
    if (!project) return { files: [] };
    const files = await data().listProjectFiles(project.id).catch(() => []);
    let budget = PROJECT_FILES_BUDGET;
    const parts: ContentPart[] = [];
    for (const f of files) {
      if (budget <= 0) break;
      const text = f.text.slice(0, budget);
      budget -= text.length;
      parts.push({ type: 'file', name: `project/${f.name}`, mime: f.mime, text, truncated: text.length < f.text.length });
    }
    return { instructions: [`Project: ${project.name}`, project.instructions].filter(Boolean).join('\n'), files: parts };
  }

  /** Runs the assistant loop for `assistant` given the preceding history. */
  async function runAssistant(conv: Conversation, history: Message[], assistant: Message) {
    const app = useApp.getState();
    const { settings } = app;
    const state = get();
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    set({ streamingId: assistant.id });

    const proj = await projectContext(conv);
    const base = buildTurns(history);
    if (proj.files.length) {
      const firstUser = base.findIndex((t) => t.role === 'user');
      if (firstUser >= 0) {
        const t = base[firstUser] as Extract<ApiTurn, { role: 'user' }>;
        base[firstUser] = { role: 'user', parts: [...proj.files, ...t.parts] };
      }
    }

    const customMode = state.mode.startsWith('custom:') ? app.modes.find((m) => `custom:${m.id}` === state.mode) : undefined;
    const common: Omit<ChatRequestBody, 'turns' | 'step' | 'mode'> = {
      tier: state.model.kind === 'tier' ? state.model.tier : undefined,
      customMode,
      instructions: settings.instructions,
      projectInstructions: proj.instructions,
      memories: settings.memoryEnabled ? app.memories.map((m) => m.content) : [],
      memoryEnabled: settings.memoryEnabled,
      tools: state.tools ?? settings.enabledTools ?? undefined,
      agent: state.agent,
      language: settings.replyLanguage,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    let resolvedMode: ModeId = state.mode;
    let resolvedModel: string | undefined = state.model.kind === 'model' ? state.model.id : undefined;
    const produced: ApiTurn[] = [];
    let stepText = '';
    let pending = '';
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (!pending) return;
      const chunk = pending;
      pending = '';
      patchMessage(assistant.id, (m) => ({ ...m, content: m.content + chunk }));
    };

    const maxSteps = (app.config?.limits.maxAgentSteps ?? 8) + 2;
    try {
      for (let step = 0; step < maxSteps; step++) {
        if (step > 0) {
          // Separate text from consecutive steps.
          const cur = get().messages.find((m) => m.id === assistant.id);
          if (cur && cur.content.trim() && !cur.content.endsWith('\n\n')) patchMessage(assistant.id, (m) => ({ ...m, content: m.content + '\n\n' }));
        }
        stepText = '';
        const body: ChatRequestBody = {
          ...common,
          turns: [...base, ...produced],
          mode: step === 0 ? state.mode : resolvedMode,
          model: resolvedModel,
          step,
          sourceOffset: get().messages.find((m) => m.id === assistant.id)?.sources?.length ?? 0,
        };
        let done: Extract<StreamEvent, { type: 'done' }> | null = null;
        for await (const ev of streamChat(body, signal)) {
          switch (ev.type) {
            case 'meta':
              resolvedMode = ev.mode;
              resolvedModel = `${ev.provider}:${ev.model}`;
              patchMessage(assistant.id, (m) => ({
                ...m,
                meta: { ...m.meta, provider: ev.provider, model: ev.model, mode: ev.mode, modeLabel: ev.modeLabel, routedBy: ev.routedBy, reason: ev.reason, fallbackFrom: ev.fallbackFrom },
              }));
              break;
            case 'text':
              stepText += ev.delta;
              pending += ev.delta;
              if (!raf) raf = requestAnimationFrame(flush);
              break;
            case 'tool_call':
              patchMessage(assistant.id, (m) => ({
                ...m,
                tools: [...(m.tools ?? []), { id: ev.call.id, name: ev.call.name, args: ev.call.args, client: ev.client, status: ev.client ? 'awaiting' : 'running' }],
              }));
              break;
            case 'tool_result':
              patchMessage(assistant.id, (m) => ({
                ...m,
                tools: (m.tools ?? []).map((t) => (t.id === ev.id ? { ...t, status: ev.ok ? 'done' : 'error', summary: ev.summary, sources: ev.sources, durationMs: ev.durationMs } : t)),
                sources: ev.sources?.length ? [...(m.sources ?? []), ...ev.sources] : m.sources,
              }));
              break;
            case 'usage':
              patchMessage(assistant.id, (m) => ({
                ...m,
                meta: {
                  ...m.meta,
                  usage: {
                    inputTokens: (m.meta?.usage?.inputTokens ?? 0) + (ev.usage.inputTokens ?? 0),
                    outputTokens: (m.meta?.usage?.outputTokens ?? 0) + (ev.usage.outputTokens ?? 0),
                  },
                },
              }));
              break;
            case 'done':
              done = ev;
              break;
            case 'error':
              throw new ApiError(500, ev.code, ev.message, ev.retryable);
          }
        }
        if (raf) cancelAnimationFrame(raf);
        flush();
        if (!done) throw new ApiError(500, 'provider_error', 'The response ended unexpectedly.', true);
        produced.push(...done.turns);
        patchMessage(assistant.id, (m) => ({ ...m, turns: [...produced], meta: { ...m.meta, stopReason: done!.stopReason } }));

        if (done.next === 'stop') break;
        if (done.next === 'client_tools') {
          const clientResults: ToolResult[] = [];
          for (const call of done.pendingClientCalls ?? []) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            clientResults.push(await runClientTool(assistant.id, conv.id, call));
          }
          const assistantTurn = done.turns[done.turns.length - 1] as Extract<ApiTurn, { role: 'assistant' }>;
          const all = [...(done.serverResults ?? []), ...clientResults];
          const ordered = (assistantTurn.toolCalls ?? []).map((c) => all.find((r) => r.id === c.id)).filter((r): r is ToolResult => !!r);
          produced.push({ role: 'tool', results: ordered });
          patchMessage(assistant.id, (m) => ({ ...m, turns: [...produced] }));
        }
      }
      patchMessage(assistant.id, (m) => ({ ...m, status: 'done' }));
    } catch (err) {
      if (raf) cancelAnimationFrame(raf);
      flush();
      const aborted = (err as Error).name === 'AbortError' || signal.aborted;
      // Keep what we have: completed turns plus the partial text of the interrupted step.
      const turns = [...produced];
      if (stepText.trim()) turns.push({ role: 'assistant', text: stepText });
      if (aborted) {
        patchMessage(assistant.id, (m) => ({ ...m, status: 'stopped', turns }));
      } else {
        const e = err instanceof ApiError ? err : new ApiError(500, 'internal', 'Something went wrong while contacting the AI provider.', true);
        patchMessage(assistant.id, (m) => ({ ...m, status: 'error', turns, error: { code: e.code, message: e.message, retryable: e.retryable } }));
      }
    } finally {
      set({ streamingId: null, permission: null });
      // Clear pending permission prompts / mark unfinished tools
      patchMessage(assistant.id, (m) => ({ ...m, tools: m.tools?.map((t) => (t.status === 'running' || t.status === 'awaiting' ? { ...t, status: 'error', summary: t.summary ?? 'Interrupted' } : t)) }));
      persist(assistant.id);
      await useApp.getState().patchConversation(conv.id, { updatedAt: Date.now(), mode: get().mode, model: modelId(get().model) });
      const finished = get().messages.find((m) => m.id === assistant.id);
      if (finished && finished.status === 'done') get().onAssistantDone?.(finished);
    }
  }

  async function ensureConversation(text: string, atts: Attachment[]): Promise<Conversation> {
    const app = useApp.getState();
    const id = get().activeId;
    const existing = id ? app.conversations.find((c) => c.id === id) : undefined;
    if (existing) return existing;
    const now = Date.now();
    const conv: Conversation = {
      id: id ?? uid(),
      title: titleFrom(text, atts),
      createdAt: now,
      updatedAt: now,
      projectId: app.activeProjectId,
      mode: get().mode,
      model: modelId(get().model),
    };
    await app.upsertConversation(conv);
    set({ activeId: conv.id });
    return conv;
  }

  return {
    activeId: null,
    messages: [],
    loading: false,
    streamingId: null,
    mode: 'auto',
    model: { kind: 'tier', tier: 'auto' },
    tools: null,
    agent: false,
    permission: null,
    onAssistantDone: null,

    async openConversation(id) {
      if (get().activeId === id) return;
      get().stop();
      const conv = useApp.getState().conversations.find((c) => c.id === id);
      set({ activeId: id, messages: [], loading: true });
      if (conv?.mode) set({ mode: conv.mode });
      if (conv?.model) set({ model: { kind: 'model', id: conv.model } });
      if (conv) useApp.getState().setActiveProject(conv.projectId ?? null);
      const msgs = await data().listMessages(id).catch(() => []);
      if (get().activeId === id) set({ messages: msgs, loading: false });
    },

    newChat(projectId) {
      get().stop();
      const app = useApp.getState();
      const pid = projectId === undefined ? app.activeProjectId : projectId;
      app.setActiveProject(pid ?? null);
      const project = pid ? app.projects.find((p) => p.id === pid) : undefined;
      set({
        activeId: null,
        messages: [],
        loading: false,
        mode: project?.preferredMode ?? app.settings.defaultMode,
        model: project?.preferredModel ? { kind: 'model', id: project.preferredModel } : app.settings.defaultModel,
        agent: false,
      });
    },

    async send(text, attachments) {
      if (get().streamingId) return;
      const conv = await ensureConversation(text, attachments);
      const now = Date.now();
      const user: Message = { id: uid(), conversationId: conv.id, role: 'user', content: text, attachments, createdAt: now };
      const assistant: Message = { id: uid(), conversationId: conv.id, role: 'assistant', content: '', createdAt: now + 1, status: 'streaming' };
      const history = [...get().messages, user];
      set({ messages: [...history, assistant] });
      persist(user.id);
      await runAssistant(conv, history, assistant);
    },

    async regenerate(assistantId) {
      if (get().streamingId) return;
      const msgs = get().messages;
      const idx = msgs.findIndex((m) => m.id === assistantId);
      const conv = useApp.getState().conversations.find((c) => c.id === get().activeId);
      if (idx < 0 || !conv) return;
      const history = msgs.slice(0, idx);
      const removed = msgs.slice(idx);
      await data().deleteMessages(removed.map((m) => m.id));
      const assistant: Message = { id: uid(), conversationId: conv.id, role: 'assistant', content: '', createdAt: Date.now(), status: 'streaming' };
      set({ messages: [...history, assistant] });
      await runAssistant(conv, history, assistant);
    },

    async editAndResend(userId, text) {
      if (get().streamingId) return;
      const msgs = get().messages;
      const idx = msgs.findIndex((m) => m.id === userId);
      const conv = useApp.getState().conversations.find((c) => c.id === get().activeId);
      if (idx < 0 || !conv) return;
      const edited: Message = { ...msgs[idx], content: text };
      const removed = msgs.slice(idx + 1);
      await data().deleteMessages(removed.map((m) => m.id));
      const history = [...msgs.slice(0, idx), edited];
      const assistant: Message = { id: uid(), conversationId: conv.id, role: 'assistant', content: '', createdAt: Date.now(), status: 'streaming' };
      set({ messages: [...history, assistant] });
      persist(edited.id);
      await runAssistant(conv, history, assistant);
    },

    stop() {
      controller?.abort();
      controller = null;
      get().permission?.resolve('deny');
    },

    setMode: (mode) => set({ mode }),
    setModel: (model) => set({ model }),
    setTools: (tools) => set({ tools }),
    setAgent: (agent) => set({ agent }),
    setOnAssistantDone: (fn) => set({ onAssistantDone: fn }),
  };
});

export function sourceIndex(sources: Source[] | undefined, n: number): Source | undefined {
  return sources?.[n - 1];
}
