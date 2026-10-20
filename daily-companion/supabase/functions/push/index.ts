// =============================================================================
// push — Web Push helpers for the app.
//   GET                          → { publicKey }  (the app needs it to subscribe)
//   POST { action: 'test', title, body } (signed in) → sends a test notification
//                                   (text already translated by the app) to all
//                                   your devices → { sent, failed }
// =============================================================================
import { admin, json, preflight, userFrom } from '../_shared/http.ts';
import { getVapid, sendToUser } from '../_shared/notify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  const db = admin();
  try {
    if (req.method === 'GET') {
      const { publicKey } = await getVapid(db);
      return json({ publicKey });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const user = await userFrom(req, db);
    if (!user) return json({ error: 'Not signed in' }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action === 'test') {
      const title = String(body.title || 'Coach').slice(0, 60);
      const text = String(body.body || 'Notifications work.').slice(0, 200);
      const r = await sendToUser(db, user.id, { title, body: text, url: './#/coach', tag: 'test' });
      return json({ sent: r.sent, failed: r.failed, statuses: r.results.map((x) => x.status) });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('push error', e);
    return json({ error: 'Server error' }, 500);
  }
});
