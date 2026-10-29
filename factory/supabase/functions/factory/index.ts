// AI Worker Factory — the one server function.
//
//   POST /factory                     actions from the interface (signed-in owner only)
//   POST /factory/run    {id}         run one task in its own invocation  (internal key)
//   POST /factory/tick                start due schedules and queued work (internal key, from pg_cron)
//   GET  /factory/google/callback     Google sign-in returns here
//   GET  /factory/workers             worker names for the interface (public, harmless)
import { HttpError, getSecret, log } from './lib/db.ts';
import { handleAction, workerNames } from './lib/api.ts';
import { runAndContinue } from './lib/pool.ts';
import { tick } from './lib/schedules.ts';
import { callback as googleCallback } from './lib/google.ts';

// Provided by the Supabase Edge Runtime: keeps work going after the response is sent.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data ?? null), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function requireInternal(req: Request) {
  const key = await getSecret('internal_key');
  if (!key || req.headers.get('x-factory-key') !== key) throw new HttpError(401, 'Unauthorized');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/factory/, '') || '/';

  try {
    if (req.method === 'GET' && path === '/google/callback') return await googleCallback(url);
    if (req.method === 'GET' && path === '/workers') return json(workerNames());

    if (req.method === 'POST' && path === '/run') {
      await requireInternal(req);
      const { id } = await req.json();
      EdgeRuntime.waitUntil(runAndContinue(id)); // answer now, keep working in the background
      return json({ accepted: true }, 202);
    }
    if (req.method === 'POST' && path === '/tick') {
      await requireInternal(req);
      EdgeRuntime.waitUntil(tick().catch((err) => log('error', 'tick.failed', { error: err.message })));
      return json({ accepted: true }, 202);
    }
    if (req.method === 'POST' && path === '/') return json(await handleAction(req));
    return json({ error: 'Not found' }, 404);
  } catch (err) {
    const status = (err as HttpError).status ?? 500;
    if (status >= 500) await log('error', 'server.error', { path, error: (err as Error).message }).catch(() => {});
    return json({ error: (err as Error).message }, status);
  }
});
