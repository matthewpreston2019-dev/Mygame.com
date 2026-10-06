import type { ErrorCode } from '../shared/types';
import { env } from './env';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers },
  });
}

/** User-facing messages. Technical details stay in the server log. */
export const FRIENDLY: Record<ErrorCode, string> = {
  unauthorized: 'Please sign in to continue.',
  forbidden: "You don't have access to this.",
  rate_limited: "You're sending requests too quickly. Please wait a moment and try again.",
  budget_exceeded: "Today's usage limit has been reached. It resets at midnight UTC (or raise the limit in your settings).",
  bad_request: 'That request could not be processed.',
  too_large: 'That message or attachment is too large. Try removing some files or shortening the text.',
  no_provider: 'No AI provider is configured yet. Add an API key in your Netlify environment variables.',
  provider_error: 'Something went wrong while contacting the AI provider.',
  provider_auth: 'The AI provider rejected the API key. Check the key in your environment variables.',
  model_not_found: 'The selected model is not available. Try another model.',
  timeout: 'The AI provider took too long to respond.',
  internal: 'Something unexpected went wrong.',
};

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message || FRIENDLY[err.code], retryable: err.retryable } }, err.status);
  }
  console.error('[lumora] unhandled error', err);
  return json({ error: { code: 'internal', message: FRIENDLY.internal, retryable: true } }, 500);
}

/**
 * CSRF / cross-site protection. Browsers always send Origin on cross-site POSTs; we require it to match
 * the site (or ALLOWED_ORIGINS), and we require a custom header that cannot be sent cross-site without CORS.
 */
export function assertSameOrigin(req: Request): void {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers.get('x-lumora') !== '1') throw new HttpError(403, 'forbidden', FRIENDLY.forbidden);
  const origin = req.headers.get('origin');
  if (!origin) return; // non-browser client (curl) — still needs valid auth
  const self = new URL(req.url).origin;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const allowed = new Set([self, ...env.allowedOrigins]);
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }
  if (!allowed.has(origin)) throw new HttpError(403, 'forbidden', FRIENDLY.forbidden);
}

export async function readJson<T>(req: Request, maxBytes: number): Promise<T> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new HttpError(413, 'too_large', FRIENDLY.too_large);
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large', FRIENDLY.too_large);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'bad_request', FRIENDLY.bad_request);
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export function methodNotAllowed(): Response {
  return json({ error: { code: 'bad_request', message: 'Method not allowed' } }, 405);
}
