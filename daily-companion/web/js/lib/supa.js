// Supabase client (auth + database). The library is loaded by index.html as
// a classic script (vendor/supabase.js) which defines window.supabase.
import { SUPABASE_URL, SUPABASE_KEY, FUNCTIONS_URL } from '../config.js';

export const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,       // stay signed in (stored in this device's storage)
    autoRefreshToken: true,
    detectSessionInUrl: false,  // we don't use email links
    storageKey: 'dc.auth',
  },
});

/**
 * Call one of our Edge Functions. Sends your session token when signed in.
 * Returns parsed JSON or throws an Error with a readable message.
 */
export async function callFunction(name, { method = 'POST', body, query = '' } = {}) {
  const { data: { session } } = await supa.auth.getSession();
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
  if (session) headers.Authorization = `Bearer ${session.access_token}`;
  let res;
  try {
    res = await fetch(`${FUNCTIONS_URL}/${name}${query}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('offline'), { offline: true });
  }
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw Object.assign(new Error(json?.error || `HTTP ${res.status}`), { status: res.status, code: json?.code });
  return json;
}
