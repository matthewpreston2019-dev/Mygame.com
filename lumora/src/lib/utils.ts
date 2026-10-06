import { clsx, type ClassValue } from 'clsx';
import { nanoid } from 'nanoid';

export const cn = (...v: ClassValue[]) => clsx(v);
export const uid = () => nanoid(16);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const downloadText = (text: string, filename: string, mime = 'text/plain') =>
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function safeFilename(s: string) {
  return s.replace(/[^\p{L}\p{N}\-_. ]/gu, '').trim().slice(0, 80) || 'chat';
}

export type DateGroup = 'today' | 'yesterday' | 'week' | 'month' | 'older';
export function dateGroup(ts: number): DateGroup {
  const d = new Date(ts);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= start) return 'today';
  if (d.getTime() >= start - 86_400_000) return 'yesterday';
  if (d.getTime() >= start - 7 * 86_400_000) return 'week';
  if (d.getTime() >= start - 30 * 86_400_000) return 'month';
  return 'older';
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', json: 'json', md: 'markdown', sh: 'bash', yml: 'yaml', yaml: 'yaml',
    rs: 'rust', go: 'go', java: 'java', rb: 'ruby', php: 'php', c: 'c', cpp: 'cpp', cs: 'csharp', sql: 'sql', kt: 'kotlin', swift: 'swift',
  };
  return map[ext] ?? 'text';
}
