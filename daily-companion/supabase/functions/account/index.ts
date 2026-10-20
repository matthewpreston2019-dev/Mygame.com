// =============================================================================
// account — create the (single) owner account and handle password recovery.
//   POST { action: 'signup', email, password }
//        → creates a confirmed account (no email needed) and returns a one-time
//          recovery code. Refused once an account exists (it's your app).
//   POST { action: 'recover', email, code, password }
//        → sets a new password if the recovery code matches.
//   POST { action: 'new_recovery_code' }  (signed in)
//        → replaces your recovery code and returns the new one.
// Recovery codes are stored only as a SHA-256 hash in app_secrets.
// =============================================================================
import { admin, json, preflight, getSecret, setSecret, sha256Hex, safeEqual, userFrom } from '../_shared/http.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Crockford base32 (no I, L, O, U) — easy to read and type.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => ALPHABET[b % 32]).join('');
  return chars.match(/.{4}/g)!.join('-'); // XXXX-XXXX-XXXX-XXXX (80 bits)
}
const normaliseCode = (c: string) => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

async function storeRecovery(db: ReturnType<typeof admin>, userId: string): Promise<string> {
  const code = newRecoveryCode();
  await setSecret(db, `recovery:${userId}`, await sha256Hex(normaliseCode(code)));
  return code;
}

async function findUserByEmail(db: ReturnType<typeof admin>, email: string) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const db = admin();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  try {
    if (body.action === 'signup') {
      if (!EMAIL_RE.test(email)) return json({ error: 'Invalid email', code: 'bad_email' }, 400);
      if (password.length < 8 || password.length > 72) return json({ error: 'Password must be 8–72 characters', code: 'weak_password' }, 400);
      const { data: list, error: le } = await db.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (le) throw le;
      const allow = (await getSecret(db, 'allow_signups')) === 'true';
      if (list.users.length > 0 && !allow) return json({ error: 'Sign-ups are closed', code: 'signups_closed' }, 403);
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) return json({ error: 'Account exists', code: 'signups_closed' }, 403);
        if (/password/i.test(error.message)) return json({ error: error.message, code: 'weak_password' }, 400);
        throw error;
      }
      const recoveryCode = await storeRecovery(db, data.user.id);
      return json({ ok: true, recoveryCode });
    }

    if (body.action === 'recover') {
      if (password.length < 8 || password.length > 72) return json({ error: 'Password must be 8–72 characters', code: 'weak_password' }, 400);
      // Same delay for every attempt: slows guessing and hides whether the email exists.
      await new Promise((r) => setTimeout(r, 700));
      const user = EMAIL_RE.test(email) ? await findUserByEmail(db, email) : null;
      const stored = user ? await getSecret(db, `recovery:${user.id}`) : null;
      const given = await sha256Hex(normaliseCode(body.code));
      if (!user || !stored || !safeEqual(stored, given)) return json({ error: 'Wrong email or recovery code', code: 'bad_code' }, 403);
      const { error } = await db.auth.admin.updateUserById(user.id, { password });
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === 'new_recovery_code') {
      const user = await userFrom(req, db);
      if (!user) return json({ error: 'Not signed in' }, 401);
      return json({ ok: true, recoveryCode: await storeRecovery(db, user.id) });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('account error', e);
    return json({ error: 'Server error' }, 500);
  }
});
