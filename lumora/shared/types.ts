// Domain types shared by the browser app and the Netlify functions.
// Keep this file free of runtime dependencies.

export type ProviderId = string; // e.g. "anthropic", "openai", "gemini", "openrouter", "groq", "ollama", "custom"

export type ProviderKind = 'anthropic' | 'openai-compatible' | 'gemini';

export type ModelTier = 'auto' | 'fast' | 'balanced' | 'powerful';

export type BuiltInModeId =
  | 'general'
  | 'coding'
  | 'research'
  | 'writing'
  | 'study'
  | 'creative'
  | 'analysis'
  | 'planner';

export type ModeId = 'auto' | BuiltInModeId | `custom:${string}`;

export type ToolName =
  | 'web_search'
  | 'read_url'
  | 'calculator'
  | 'datetime'
  | 'weather'
  | 'json_tool'
  | 'data_analysis'
  | 'run_code'
  | 'remember';

/** A piece of user-supplied content. Files are parsed in the browser and sent as text. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }
  | { type: 'file'; name: string; mime: string; text: string; truncated?: boolean };

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Provider-specific data that must be echoed back (e.g. Gemini thought signatures). */
  meta?: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  /** What the model sees. */
  content: string;
  isError?: boolean;
}

/** Provider-native assistant content, replayed verbatim when the same provider+model continues. */
export interface NativeAssistantState {
  provider: ProviderId;
  model: string;
  blocks: unknown;
}

/** Turns sent to /api/chat. A provider-neutral conversation format. */
export type ApiTurn =
  | { role: 'user'; parts: ContentPart[] }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[]; native?: NativeAssistantState }
  | { role: 'tool'; results: ToolResult[] };

export interface Source {
  title: string;
  url: string;
  snippet?: string;
}

export interface CustomModeDef {
  id: string;
  name: string;
  description?: string;
  instructions: string;
  personality?: string;
  model?: string; // "provider:model" or "" for automatic
  tier?: ModelTier;
  temperature?: number;
  tools: ToolName[];
}

export interface CustomInstructions {
  enabled: boolean;
  name?: string;
  responseStyle?: string;
  language?: string;
  technicalLevel?: string;
  personality?: string;
  about?: string;
  avoid?: string;
}

export interface ChatRequestBody {
  turns: ApiTurn[];
  mode: ModeId;
  /** Explicit "provider:model" or a tier. */
  model?: string;
  tier?: ModelTier;
  customMode?: CustomModeDef;
  instructions?: CustomInstructions;
  projectInstructions?: string;
  memories?: string[];
  memoryEnabled?: boolean;
  /** Tools the user has switched on in the composer. */
  tools?: ToolName[];
  agent?: boolean;
  /** Preferred reply language from settings (BCP-47 or "auto"). */
  language?: string;
  timezone?: string;
  /** Which loop step this is (0 for a fresh user message). */
  step?: number;
  /** Sources already cited in this answer (keeps citation numbers unique across steps). */
  sourceOffset?: number;
}

export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
}

/** Newline-delimited JSON events streamed from /api/chat. */
export type StreamEvent =
  | {
      type: 'meta';
      mode: ModeId;
      modeLabel: string;
      provider: ProviderId;
      model: string;
      routedBy: 'user' | 'auto';
      reason?: string;
      fallbackFrom?: string;
    }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall; client: boolean }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      ok: boolean;
      summary: string;
      sources?: Source[];
      durationMs: number;
    }
  | { type: 'usage'; usage: UsageInfo }
  | {
      type: 'done';
      stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'error';
      /** Turns to append to the history (assistant turn + server tool results). */
      turns: ApiTurn[];
      /** What the client should do next. */
      next: 'stop' | 'continue' | 'client_tools';
      pendingClientCalls?: ToolCall[];
      /** Results of server tools from this step when client tools are still pending. */
      serverResults?: ToolResult[];
    }
  | { type: 'error'; code: ErrorCode; message: string; retryable: boolean };

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'budget_exceeded'
  | 'bad_request'
  | 'too_large'
  | 'no_provider'
  | 'provider_error'
  | 'provider_auth'
  | 'model_not_found'
  | 'timeout'
  | 'internal';

export interface ModelInfo {
  id: string; // "provider:model"
  provider: ProviderId;
  model: string;
  label: string;
  vision: boolean;
  contextWindow?: number;
  tools?: boolean;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
}

export interface TierMap {
  fast?: string;
  balanced?: string;
  powerful?: string;
  vision?: string;
  longContext?: string;
}

export interface PublicConfig {
  appName: string;
  authMode: 'supabase' | 'password' | 'none' | 'locked';
  supabase?: { url: string; anonKey: string; oauthProviders: string[] };
  providers: ProviderInfo[];
  searchProvider: string | null;
  transcription: boolean;
  limits: {
    maxFileBytes: number;
    maxRequestBytes: number;
    maxFiles: number;
    maxAgentSteps: number;
  };
  devWarning?: string;
}

export interface SessionInfo {
  authenticated: boolean;
  userId?: string;
  email?: string;
  isAdmin?: boolean;
}
