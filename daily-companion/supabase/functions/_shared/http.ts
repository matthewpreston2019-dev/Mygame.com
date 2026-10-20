// Helpers shared by all Edge Functions.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-steps-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const preflight = () => new Response('ok', { headers: CORS });

/** Database client with full access (service role). Server-side only! */
export function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The signed-in user from the request's Bearer token, or null. */
export async function userFrom(req: Request, db: SupabaseClient) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error ? null : data.user;
}

/** Read a server-only value from app_secrets. */
export async function getSecret(db: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await db.from('app_secrets').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

export async function setSecret(db: SupabaseClient, key: string, value: string) {
  const { error } = await db.from('app_secrets').upsert({ key, value });
  if (error) throw error;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison (avoids timing leaks on secrets). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
