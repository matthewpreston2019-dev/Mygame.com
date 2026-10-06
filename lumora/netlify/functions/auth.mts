import type { Config } from '@netlify/functions';
import { authMode, checkPassword, createSessionToken, sessionCookie } from '../../server/auth';
import { assertSameOrigin, clientIp, errorResponse, HttpError, json, readJson } from '../../server/http';
import { rateLimit } from '../../server/limits';
import { logEvent } from '../../server/logger';

// Password-mode login/logout. (Supabase mode authenticates directly with Supabase in the browser.)
export default async (req: Request) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'bad_request', 'Method not allowed');
    assertSameOrigin(req);
    const action = new URL(req.url).pathname.split('/').pop();
    if (action === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(req, null) });
    if (action !== 'login') throw new HttpError(404, 'bad_request', 'Not found');
    if (authMode() !== 'password') throw new HttpError(400, 'bad_request', 'Password login is not enabled.');
    const ip = clientIp(req);
    await rateLimit(`login/${ip}`, 10, 15 * 60_000);
    const { password } = await readJson<{ password?: unknown }>(req, 10_000);
    if (typeof password !== 'string' || !checkPassword(password)) {
      void logEvent({ kind: 'auth', ok: false, detail: 'failed password login' });
      await new Promise((r) => setTimeout(r, 400));
      throw new HttpError(401, 'unauthorized', 'Incorrect password.');
    }
    void logEvent({ kind: 'auth', ok: true, detail: 'password login' });
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(req, createSessionToken()) });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: ['/api/auth/login', '/api/auth/logout'] };
