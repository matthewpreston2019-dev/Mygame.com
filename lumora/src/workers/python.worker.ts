/// <reference lib="webworker" />
// Runs Python with Pyodide (CPython compiled to WebAssembly) inside a dedicated worker.
// No access to the page, cookies or your files; network is limited to what the browser CSP allows.

const PYODIDE_URL = (import.meta.env.VITE_PYODIDE_URL as string | undefined) ?? 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';

interface PyodideLike {
  runPythonAsync(code: string): Promise<unknown>;
  loadPackagesFromImports(code: string, opts?: { messageCallback?: (m: string) => void }): Promise<void>;
  setStdout(o: { batched: (s: string) => void }): void;
  setStderr(o: { batched: (s: string) => void }): void;
}

let pyodide: Promise<PyodideLike> | null = null;

async function load(): Promise<PyodideLike> {
  const mod = (await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)) as { loadPyodide: (o: { indexURL: string }) => Promise<PyodideLike> };
  return mod.loadPyodide({ indexURL: PYODIDE_URL });
}

self.onmessage = async (e: MessageEvent<{ code: string }>) => {
  const out: string[] = [];
  const err: string[] = [];
  try {
    pyodide ??= load();
    const py = await pyodide;
    py.setStdout({ batched: (s) => out.push(s) });
    py.setStderr({ batched: (s) => err.push(s) });
    await py.loadPackagesFromImports(e.data.code, { messageCallback: () => {} });
    const result = await py.runPythonAsync(e.data.code);
    const value = result === undefined || result === null ? '' : String(result);
    (self as unknown as Worker).postMessage({ ok: true, stdout: out.join('\n'), stderr: err.join('\n'), result: value });
  } catch (ex) {
    (self as unknown as Worker).postMessage({ ok: false, stdout: out.join('\n'), stderr: [...err, String((ex as Error)?.message ?? ex)].join('\n') });
  }
};
