import type { ApiTurn, ErrorCode, ModelInfo, NativeAssistantState, ProviderId, ProviderKind, ToolCall, UsageInfo } from '../../shared/types';

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema subset understood by all providers (type/properties/required/enum/items/description). */
  parameters: Record<string, unknown>;
}

export interface ProviderRequest {
  model: string;
  system: string;
  turns: ApiTurn[];
  tools: ToolSpec[];
  temperature?: number;
  maxTokens: number;
  signal: AbortSignal;
}

export type ProviderEvent =
  | { type: 'text'; delta: string }
  | {
      type: 'done';
      text: string;
      toolCalls: ToolCall[];
      stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal';
      usage: UsageInfo;
      native?: NativeAssistantState;
    };

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  listModels(): Promise<ModelInfo[]>;
  stream(req: ProviderRequest): AsyncGenerator<ProviderEvent>;
}

export class ProviderError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status?: number,
    public retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Maps an HTTP status from a provider to our error taxonomy. */
export function providerErrorFromStatus(status: number, body: string, provider: string): ProviderError {
  const detail = `${provider} HTTP ${status}: ${body.slice(0, 400)}`;
  if (status === 401 || status === 403) return new ProviderError('provider_auth', detail, status);
  if (status === 404) return new ProviderError('model_not_found', detail, status);
  if (status === 408 || status === 504) return new ProviderError('timeout', detail, status, true);
  if (status === 413) return new ProviderError('too_large', detail, status);
  if (status === 429 || status >= 500) return new ProviderError('provider_error', detail, status, true);
  return new ProviderError('bad_request', detail, status);
}

export function fileToText(p: { name: string; mime: string; text: string; truncated?: boolean }): string {
  const safeName = p.name.replace(/["<>]/g, '_');
  return `<attached_file name="${safeName}" type="${p.mime}"${p.truncated ? ' truncated="true"' : ''}>\n${p.text}\n</attached_file>`;
}

/** Heuristic vision detection for providers that do not report capabilities. */
export function guessVision(id: string): boolean {
  return /(vision|gpt-4o|gpt-4\.1|gpt-5|\bo3\b|\bo4|llava|gemma-?3|qwen.*vl|pixtral|llama-4|llama3\.2-vision|claude|gemini|maverick|scout|minicpm-v|moondream|bakllava)/i.test(id);
}

/** Sorts ids by the highest embedded version number (e.g. gemini-2.5 > gemini-2.0). */
export function versionScore(id: string): number {
  const m = id.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}
