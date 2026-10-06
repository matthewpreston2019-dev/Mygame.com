import type { ApiTurn, CustomInstructions, CustomModeDef, ErrorCode, ModeId, ModelTier, Source, ToolName, UsageInfo } from '@shared/types';

export interface Attachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mime: string;
  size: number;
  /** Extracted text for documents/code/data. */
  text?: string;
  truncated?: boolean;
  /** Base64 (no prefix) for images, already downscaled. */
  data?: string;
  /** Human-readable note about how the file was processed. */
  note?: string;
}

export interface ToolActivity {
  id: string;
  name: string;
  args: Record<string, unknown>;
  client: boolean;
  status: 'running' | 'done' | 'error' | 'awaiting' | 'denied';
  summary?: string;
  output?: string;
  sources?: Source[];
  durationMs?: number;
}

export interface MessageMeta {
  provider?: string;
  model?: string;
  mode?: ModeId;
  modeLabel?: string;
  routedBy?: 'user' | 'auto';
  reason?: string;
  fallbackFrom?: string;
  usage?: UsageInfo;
  stopReason?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  attachments?: Attachment[];
  turns?: ApiTurn[];
  tools?: ToolActivity[];
  sources?: Source[];
  meta?: MessageMeta;
  status?: 'streaming' | 'done' | 'error' | 'stopped';
  error?: { code: ErrorCode; message: string; retryable: boolean };
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  projectId?: string | null;
  mode?: ModeId;
  model?: string;
}

export interface Memory {
  id: string;
  content: string;
  source?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  instructions: string;
  preferredMode?: ModeId;
  preferredModel?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  name: string;
  mime: string;
  size: number;
  text: string;
  createdAt: number;
}

export interface CodeFile {
  path: string;
  content: string;
  updatedAt: number;
}

export type ModelChoice = { kind: 'tier'; tier: ModelTier } | { kind: 'model'; id: string };

export interface Settings {
  theme: 'system' | 'dark' | 'light';
  uiLanguage: string;
  replyLanguage: string;
  instructions: CustomInstructions;
  memoryEnabled: boolean;
  defaultMode: ModeId;
  defaultModel: ModelChoice;
  enabledTools: ToolName[] | null;
  enterToSend: boolean;
  autoApproveCode: boolean;
  voice: { autoSpeak: boolean; voiceURI?: string; rate: number };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  uiLanguage: 'auto',
  replyLanguage: 'auto',
  instructions: { enabled: false },
  memoryEnabled: true,
  defaultMode: 'auto',
  defaultModel: { kind: 'tier', tier: 'auto' },
  enabledTools: null,
  enterToSend: true,
  autoApproveCode: false,
  voice: { autoSpeak: false, rate: 1 },
};

export interface SharedSnapshot {
  title: string;
  createdAt: number;
  messages: Pick<Message, 'role' | 'content' | 'sources' | 'meta'>[];
}

export type { CustomModeDef };
