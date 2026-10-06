import type { Source, ToolName } from '../../shared/types';
import type { ToolSpec } from '../providers/types';

export interface ToolContext {
  timezone: string;
  /** Attached files from the conversation, by name (for data tools). */
  files: Map<string, string>;
  /** Number of sources already shown in this answer, so citation numbers stay unique. */
  sourceOffset: number;
  signal: AbortSignal;
}

export interface ToolOutput {
  /** Text the model receives. */
  content: string;
  /** Short human-readable summary for the activity panel. */
  summary: string;
  sources?: Source[];
}

export interface ToolDef {
  name: ToolName;
  spec: ToolSpec;
  /** Client tools run in the browser (sandboxed code, memory). */
  client?: boolean;
  /** 'confirm' tools require explicit user permission before running. */
  risk: 'safe' | 'confirm';
  run?: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutput>;
}

export class ToolInputError extends Error {}

export const str = (v: unknown, name: string, max = 10_000): string => {
  if (typeof v !== 'string' || !v.trim()) throw new ToolInputError(`"${name}" must be a non-empty string`);
  if (v.length > max) throw new ToolInputError(`"${name}" is too long (max ${max} characters)`);
  return v;
};

export const optStr = (v: unknown, max = 10_000): string | undefined =>
  typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined;

export const optNum = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
