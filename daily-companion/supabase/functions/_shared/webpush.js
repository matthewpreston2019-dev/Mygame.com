// =============================================================================
// Web Push sender — standards-only, no dependencies (uses the Web Crypto API,
// available in Supabase Edge Functions / Deno and in Node for tests).
//
//  * VAPID (RFC 8292): proves to Apple/Google/Mozilla that the push comes
//    from this server, using an ES256-signed JWT.
//  * Message encryption (RFC 8291, "aes128gcm" from RFC 8188): the payload is
//    end-to-end encrypted so only your device can read it.
// =============================================================================

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

/** HKDF-SHA256 (extract + expand) → `len` bytes. */
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

/** New VAPID key pair: { publicKey: base64url (65-byte point), privateJwk } */
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicKey: b64urlEncode(raw), privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } };
}

/** The `Authorization: vapid t=…, k=…` header for one push service. */
export async function vapidHeader(endpoint, vapid, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', { ...vapid.privateJwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // Web Crypto returns the raw r||s signature, which is exactly what JWS ES256 wants.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${vapid.publicKey}`;
}

/**
 * Encrypt a payload for one subscription (RFC 8291 / aes128gcm).
 * p256dh / auth are the base64url keys from the browser's PushSubscription.
 */
export async function encryptPayload(plaintext, p256dh, auth) {
  const uaPublic = b64urlDecode(p256dh);   // 65 bytes
  const authSecret = b64urlDecode(auth);   // 16 bytes
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info\0" || ua_public || as_public, 32)
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // Single record: plaintext followed by the 0x02 "last record" delimiter.
  const record = concat(plaintext, new Uint8Array([2]));
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record));

  // Header: salt(16) | record size(4, big-endian) | key id length(1) | key id (our public key)
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/**
 * Shorten a notification text to at most `max` characters, ending in "…".
 * Counts real characters (code points), so an emoji is never cut in half
 * (half an emoji shows up as a broken "�"). Prefers to stop at a line break.
 */
export function shortenText(text, max = 380) {
  const str = String(text ?? '');
  const chars = Array.from(str);
  if (chars.length <= max) return str;
  let cut = chars.slice(0, max - 1).join('');
  const nl = cut.lastIndexOf('\n');
  if (nl > cut.length * 0.6) cut = cut.slice(0, nl); // keep whole lines if that loses little
  return cut.trimEnd() + '…';
}

/**
 * Send one push. `sub` = { endpoint, p256dh, auth }, `payload` = any JSON.
 * Returns { ok, status, gone } — gone means the subscription no longer exists
 * (app deleted / permission revoked) and should be removed.
 */
export async function sendPush(sub, payload, vapid, { subject, ttl = 24 * 3600, urgency = 'normal', topic } = {}) {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub.p256dh, sub.auth);
  const headers = {
    Authorization: await vapidHeader(sub.endpoint, vapid, subject),
    TTL: String(ttl),
    Urgency: urgency,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
  };
  // Topic (max 32 url-safe chars) lets a newer message replace an undelivered older one.
  if (topic) headers.Topic = String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  let res;
  try {
    res = await fetch(sub.endpoint, { method: 'POST', headers, body });
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: String(e) };
  }
  const text = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 300);
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410, error: text };
}
