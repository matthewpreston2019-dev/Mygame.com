// Sending push notifications to all of a user's devices, with bookkeeping:
// dead subscriptions are removed, repeated failures are counted.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { generateVapidKeys, sendPush, shortenText } from './webpush.js';
import { getSecret } from './http.ts';

type Vapid = { publicKey: string; privateJwk: JsonWebKey };

/**
 * The server's VAPID key pair. Created automatically the first time and kept
 * in app_secrets (one row, so the public and private halves always match).
 */
export async function getVapid(db: SupabaseClient): Promise<Vapid> {
  const stored = await getSecret(db, 'vapid');
  if (stored) return JSON.parse(stored);
  const keys = await generateVapidKeys();
  await db.from('app_secrets').upsert({ key: 'vapid', value: JSON.stringify(keys) }, { onConflict: 'key', ignoreDuplicates: true });
  // Re-read: if another request created keys at the same moment, use theirs.
  return JSON.parse((await getSecret(db, 'vapid'))!);
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string; badge?: number };

const MAX_FAILURES = 10;

/**
 * Send to every active subscription of a user.
 * opts.ttl – seconds the push service keeps the message for a phone that's
 *            offline; after that it's dropped (default 24 h).
 */
export async function sendToUser(db: SupabaseClient, userId: string, payload: PushPayload, opts: { ttl?: number } = {}) {
  const { data: subs, error } = await db.from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failures').eq('user_id', userId).eq('deleted', false);
  if (error) throw error;
  if (!subs?.length) return { sent: 0, failed: 0, results: [] };

  const vapid = await getVapid(db);
  const subject = (await getSecret(db, 'vapid_subject')) || 'mailto:daily-companion@users.noreply.github.com';
  // Keep the payload well under the 4 KB push limit (the full text is in the app).
  const message = { ...payload, body: shortenText(payload.body, 380) };

  const results = [];
  for (const s of subs) {
    const r = await sendPush(s, message, vapid, { subject, topic: payload.tag, urgency: 'normal', ttl: opts.ttl ?? 24 * 3600 });
    results.push({ id: s.id, status: r.status, ok: r.ok, error: r.error });
    if (r.ok) {
      await db.from('push_subscriptions').update({ failures: 0, last_ok_at: new Date().toISOString() }).eq('id', s.id);
    } else if (r.gone) {
      await db.from('push_subscriptions').update({ deleted: true }).eq('id', s.id);
    } else {
      const failures = (s.failures || 0) + 1;
      await db.from('push_subscriptions').update({ failures, deleted: failures >= MAX_FAILURES }).eq('id', s.id);
      console.error('push failed', r.status, r.error);
    }
  }
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
