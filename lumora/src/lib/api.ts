import type { ErrorCode } from '@shared/types';
import { accessToken } from './supabase';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

/** fetch() wrapper: adds the CSRF header and the Supabase bearer token, and normalises errors. */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-lumora', '1');
  const token = await accessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'provider_error', "Can't reach the server. Check your connection and try again.", true);
  }
  if (!res.ok) {
    let body: { error?: { code?: ErrorCode; message?: string; retryable?: boolean } } = {};
    try {
      body = await res.json();
    } catch {
      /* not JSON (e.g. 404 from dev server) */
    }
    const fallback =
      res.status === 404 ? 'The API is not reachable. Run the app with `netlify dev` (not plain `vite`).' : 'Something went wrong. Please try again.';
    throw new ApiError(res.status, body.error?.code ?? 'internal', body.error?.message ?? fallback, body.error?.retryable ?? res.status >= 500);
  }
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(path, init);
  return (await res.json()) as T;
}

export const postJson = <T>(path: string, body: unknown, init: RequestInit = {}) =>
  apiJson<T>(path, { ...init, method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...init.headers } });
