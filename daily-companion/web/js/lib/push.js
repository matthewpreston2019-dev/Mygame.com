// =============================================================================
// Web Push on this device.
// iPhone: works only when the app is installed to the Home Screen (iOS 16.4+)
// and permission is granted from a tap. The subscription (an address at
// Apple's/Google's push service) is stored in Supabase so the coach can reach
// you even when the app is closed.
// =============================================================================

import { supa, callFunction } from './supa.js';
import { isStandalone, platform } from './ui.js';
import { coachText } from '../shared/coach.js';

const KEY_CACHE = 'dc.vapidKey';

export function pushSupport() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const p = platform();
  return {
    supported,
    // On iPhone, push only exists inside the installed app.
    needsInstall: p.iOS && !isStandalone(),
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
  };
}

async function publicKey() {
  try {
    const cached = localStorage.getItem(KEY_CACHE);
    if (cached) return cached;
  } catch { /* storage blocked */ }
  const { publicKey: k } = await callFunction('push', { method: 'GET' });
  try { localStorage.setItem(KEY_CACHE, k); } catch { /* ignore */ }
  return k;
}

function keyToBytes(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function saveSubscription(sub) {
  const j = sub.toJSON();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('not signed in');
  const { error } = await supa.from('push_subscriptions').upsert({
    user_id: user.id,
    endpoint: j.endpoint,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
    user_agent: navigator.userAgent.slice(0, 200),
    failures: 0,
    deleted: false,
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

/** Current subscription on this device (or null). */
export async function currentSubscription() {
  if (!pushSupport().supported) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * Ask permission (must be called from a tap) and subscribe.
 * Returns 'enabled' | 'denied' | 'needs-install' | 'unsupported' | 'offline'.
 */
export async function enablePush() {
  const s = pushSupport();
  if (s.needsInstall) return 'needs-install';
  if (!s.supported) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const key = await publicKey();
    if (sub) {
      // If the server key changed, the old subscription is useless.
      const subKey = sub.options?.applicationServerKey;
      if (subKey && btoa(String.fromCharCode(...new Uint8Array(subKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== key) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(key) });
    await saveSubscription(sub);
    return 'enabled';
  } catch (e) {
    console.error('push subscribe failed', e);
    if (e.offline || !navigator.onLine) return 'offline';
    throw e;
  }
}

/** Turn push off for this device. */
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await supa.from('push_subscriptions').update({ deleted: true }).eq('endpoint', endpoint);
}

/**
 * Called on app start: if this device is subscribed, make sure Supabase still
 * has it (subscriptions can rotate). Silent — never prompts.
 */
export async function refreshPushSubscription() {
  try {
    if (!pushSupport().supported || Notification.permission !== 'granted') return;
    const sub = await currentSubscription();
    if (sub) await saveSubscription(sub);
  } catch { /* offline — next launch will retry */ }
}

/** Ask the server to send a test notification to all your devices. */
export async function sendTestPush(lang) {
  const T = coachText(lang);
  return callFunction('push', { body: { action: 'test', title: T.title.test, body: T.test } });
}
