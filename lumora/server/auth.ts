// Authentication & authorization for the API.
//
// Modes:
//  - supabase: Supabase Auth (email/password + OAuth). The browser sends the Supabase access token as a
//              Bearer token; we verify it with Supabase and apply ALLOWED_EMAILS / ADMIN_EMAILS.
//  - password: single-owner mode protected by APP_PASSWORD. Issues an HMAC-signed, HttpOnly cookie.
//  - none:     no auth. Only automatic under `netlify dev`, or when AUTH_MODE=none is set explicitly.
//  - locked:   production without any auth configured → every API call is refused.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PublicConfig, SessionInfo } from '../shared/types';
import { env } from './env';
import { FRIENDLY, HttpError } from './http';

export type AuthMode = PublicConfig['authMode'];

export interface AuthedUser {
  id: string;
  email?: string;
  isAdmin: boolean;
}

export function authMode(): AuthMode {
  const s = env.authModeSetting;
  if (s === 'supabase' || s === 'password' || s === 'none') return s;
  if (env.supabaseUrl && env.supabaseAnonKey) return 'supabase';
  if (env.appPassword) return 'password';
  if (env.isLocalDev) return 'none';
  return 'locked';
}

// ---------------------------------------------------------------------------------------------
// Password-mode sessions

const COOKIE = 'lumora_session';
const SESSION_DAYS = 30;

function sessionSecret(): string {
  if (env.sessionSecret) return env.sessionSecret;
  // Derived from the password so that changing APP_PASSWORD invalidates every session.
  return createHash('sha256').update(`lumora-session:${env.appPassword ?? ''}`).digest('hex');
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function createSessionToken(sub = 'owner', days = SESSION_DAYS): string {
  const payload = b64url(JSON.stringify({ sub, exp: Date.now() + days * 86_400_000 }));
  const sig = b64url(createHmac('sha256', sessionSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined): { sub: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', sessionSecret()).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub: string; exp: number };
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return { sub: data.sub };
  } catch {
    return null;
  }
}

export function checkPassword(given: string): boolean {
  const expected = env.appPassword;
  if (!expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function sessionCookie(req: Request, token: string | null): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  if (!token) return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86_400}${secure}`;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Supabase verification (with a short in-memory cache per function instance)

const tokenCache = new Map<string, { user: AuthedUser; until: number }>();

async function verifySupabase(token: string): Promise<AuthedUser | null> {
  const cached = tokenCache.get(token);
  if (cached && cached.until > Date.now()) return cached.user;
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.supabaseAnonKey ?? '', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = (await res.json()) as { id: string; email?: string };
  const email = data.email?.toLowerCase();
  const allowed = env.allowedEmails;
  const open = process.env.OPEN_SIGNUPS === 'true';
  if (!open && (!email || !allowed.includes(email))) {
    throw new HttpError(403, 'forbidden', "Your account isn't on this workspace's allow-list (ALLOWED_EMAILS).");
  }
  const admins = env.adminEmails;
  const isAdmin = !!email && (admins.length > 0 ? admins.includes(email) : allowed.includes(email));
  const user = { id: data.id, email, isAdmin };
  if (tokenCache.size > 500) tokenCache.clear();
  tokenCache.set(token, { user, until: Date.now() + 60_000 });
  return user;
}

/** Returns the user or null. Throws HttpError(403) for authenticated-but-not-allowed users. */
export async function getUser(req: Request): Promise<AuthedUser | null> {
  const mode = authMode();
  if (mode === 'none') return { id: 'local', isAdmin: true };
  if (mode === 'locked') return null;
  if (mode === 'password') {
    const s = verifySessionToken(readCookie(req, COOKIE));
    return s ? { id: s.sub, isAdmin: true } : null;
  }
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (!token) return null;
  return verifySupabase(token);
}

export async function requireUser(req: Request): Promise<AuthedUser> {
  const user = await getUser(req);
  if (!user) {
    if (authMode() === 'locked')
      throw new HttpError(503, 'unauthorized', 'This deployment has no authentication configured. Set APP_PASSWORD or Supabase variables.');
    throw new HttpError(401, 'unauthorized', FRIENDLY.unauthorized);
  }
  return user;
}

export async function sessionInfo(req: Request): Promise<SessionInfo> {
  try {
    const u = await getUser(req);
    return u ? { authenticated: true, userId: u.id, email: u.email, isAdmin: u.isAdmin } : { authenticated: false };
  } catch {
    return { authenticated: false };
  }
}
