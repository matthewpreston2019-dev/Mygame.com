// Vite dev-server plugin that runs the Netlify functions in-process, so `npm run dev:vite` works
// without the Netlify CLI. (`netlify dev` remains the most production-like option.)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Plugin, ViteDevServer } from 'vite';

const FUNCTIONS_DIR = 'netlify/functions';

function routesFromSource(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const m = src.match(/path:\s*(\[[^\]]*\]|'[^']*')/);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

export function netlifyFunctionsDev(env: Record<string, string>): Plugin {
  return {
    name: 'lumora-netlify-functions-dev',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      Object.assign(process.env, env, { NETLIFY_DEV: process.env.NETLIFY_DEV ?? 'true' });
      const routes = new Map<string, string>();
      for (const f of readdirSync(FUNCTIONS_DIR)) {
        if (!/\.m?ts$/.test(f)) continue;
        for (const r of routesFromSource(join(FUNCTIONS_DIR, f))) routes.set(r, join(FUNCTIONS_DIR, f));
      }
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const file = routes.get(url.pathname);
        if (!file) return next();
        try {
          const mod = (await server.ssrLoadModule('/' + file)) as { default: (r: Request) => Promise<Response> | Response };
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const controller = new AbortController();
          res.on('close', () => !res.writableFinished && controller.abort());
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
          const request = new Request(url, {
            method: req.method,
            headers,
            body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
            signal: controller.signal,
            // @ts-expect-error Node fetch requires duplex for streamed bodies
            duplex: 'half',
          });
          const response = await mod.default(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          if (!response.body) return res.end();
          const reader = response.body.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        } catch (err) {
          console.error('[functions-dev]', err);
          if (!res.headersSent) res.statusCode = 500;
          res.end(JSON.stringify({ error: { code: 'internal', message: 'Function crashed (see terminal)' } }));
        }
      });
    },
  };
}
