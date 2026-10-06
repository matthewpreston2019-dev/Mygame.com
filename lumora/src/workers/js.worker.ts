/// <reference lib="webworker" />
// Runs JavaScript in an isolated worker (no DOM, no cookies, no storage of the app). Network APIs are disabled.

const g = self as unknown as Record<string, unknown>;
for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel']) {
  try {
    g[k] = undefined;
  } catch {
    /* ignore */
  }
}

const fmt = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() + 'n' : val), 2) ?? String(v);
  } catch {
    return String(v);
  }
};

self.onmessage = async (e: MessageEvent<{ code: string }>) => {
  const out: string[] = [];
  const err: string[] = [];
  const consoleShim = {
    log: (...a: unknown[]) => out.push(a.map(fmt).join(' ')),
    info: (...a: unknown[]) => out.push(a.map(fmt).join(' ')),
    warn: (...a: unknown[]) => err.push(a.map(fmt).join(' ')),
    error: (...a: unknown[]) => err.push(a.map(fmt).join(' ')),
    table: (v: unknown) => out.push(fmt(v)),
  };
  try {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;
    const fn = new AsyncFunction('console', `"use strict";\n${e.data.code}`);
    const result = await fn(consoleShim);
    (self as unknown as Worker).postMessage({ ok: true, stdout: out.join('\n'), stderr: err.join('\n'), result: result === undefined ? '' : fmt(result) });
  } catch (ex) {
    const msg = ex instanceof Error ? `${ex.name}: ${ex.message}` : String(ex);
    (self as unknown as Worker).postMessage({ ok: false, stdout: out.join('\n'), stderr: [...err, msg].join('\n') });
  }
};
