// Proves the Web Push encryption + VAPID signing are standards-correct by
// decrypting with Mozilla's reference implementation (http_ece) and verifying
// the JWT signature. Needs `npm i http_ece` somewhere on NODE_PATH:
//   NODE_PATH=/path/to/node_modules node --test tests/webpush.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createECDH, randomBytes } from 'node:crypto';
import { encryptPayload, generateVapidKeys, vapidHeader, b64urlDecode, b64urlEncode } from '../supabase/functions/_shared/webpush.js';

const ece = createRequire(import.meta.url)('http_ece');

test('payload decrypts with the reference implementation (RFC 8291)', async () => {
  // A fake browser subscription.
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const payload = { title: 'Coach', body: 'Gym in 30 min — Upper day. Ünïcödé ✓ العربية 中文', url: './#/coach', badge: 3 };
  const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(payload)), b64urlEncode(ua.getPublicKey()), b64urlEncode(auth));
  const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth.toString('base64url') });
  assert.deepEqual(JSON.parse(plain.toString('utf8')), payload);
});

test('VAPID JWT is a valid ES256 signature with the right claims', async () => {
  const vapid = await generateVapidKeys();
  const h = await vapidHeader('https://web.push.apple.com/QGuQyavXutnMH...', vapid, 'https://example.netlify.app');
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h);
  assert.ok(m, h);
  const [hdr, claims, sig] = m[1].split('.');
  const c = JSON.parse(new TextDecoder().decode(b64urlDecode(claims)));
  assert.equal(c.aud, 'https://web.push.apple.com');
  assert.equal(c.sub, 'https://example.netlify.app');
  assert.ok(c.exp > Date.now() / 1000 && c.exp <= Date.now() / 1000 + 24 * 3600);
  assert.equal(m[2], vapid.publicKey);
  assert.equal(b64urlDecode(vapid.publicKey).length, 65);
  const pub = await crypto.subtle.importKey('raw', b64urlDecode(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(sig), new TextEncoder().encode(`${hdr}.${claims}`));
  assert.equal(ok, true);
});
