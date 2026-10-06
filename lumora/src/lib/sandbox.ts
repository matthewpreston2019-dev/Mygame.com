// Sandboxed code execution in Web Workers. Code never runs on the server.

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  result?: string;
  timedOut?: boolean;
  durationMs: number;
}

let pyWorker: Worker | null = null;

function spawn(lang: 'python' | 'javascript'): Worker {
  if (lang === 'python') {
    // Keep the Python worker warm (Pyodide takes a few seconds to load the first time).
    pyWorker ??= new Worker(new URL('../workers/python.worker.ts', import.meta.url), { type: 'module' });
    return pyWorker;
  }
  return new Worker(new URL('../workers/js.worker.ts', import.meta.url), { type: 'module' });
}

export function runCode(language: string, code: string, timeoutMs = 20_000): Promise<RunResult> {
  const lang = /^py/i.test(language) ? 'python' : /^(js|javascript|node|ts)/i.test(language) ? 'javascript' : null;
  if (!lang) return Promise.resolve({ ok: false, stdout: '', stderr: `Language "${language}" can't run in the browser sandbox (Python and JavaScript only).`, durationMs: 0 });
  const started = performance.now();
  const worker = spawn(lang);
  const timeout = lang === 'python' && !pyLoaded ? timeoutMs + 40_000 : timeoutMs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.terminate();
      if (worker === pyWorker) pyWorker = null;
      resolve({ ok: false, stdout: '', stderr: `Execution stopped after ${Math.round(timeout / 1000)}s.`, timedOut: true, durationMs: performance.now() - started });
    }, timeout);
    worker.onmessage = (e: MessageEvent<Omit<RunResult, 'durationMs'>>) => {
      clearTimeout(timer);
      if (lang === 'python') pyLoaded = true;
      else worker.terminate();
      resolve({ ...e.data, durationMs: performance.now() - started });
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      if (worker === pyWorker) pyWorker = null;
      resolve({ ok: false, stdout: '', stderr: e.message || 'Sandbox failed to start (check your connection for Python).', durationMs: performance.now() - started });
    };
    worker.postMessage({ code });
  });
}

let pyLoaded = false;

export function formatRunResult(r: RunResult): string {
  const parts = [];
  if (r.stdout) parts.push(`stdout:\n${r.stdout}`);
  if (r.result) parts.push(`result: ${r.result}`);
  if (r.stderr) parts.push(`stderr:\n${r.stderr}`);
  if (!parts.length) parts.push('(no output)');
  const text = parts.join('\n\n');
  return text.length > 20_000 ? text.slice(0, 20_000) + '\n…[output truncated]' : text;
}
