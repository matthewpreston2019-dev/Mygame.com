import type { SupabaseClient } from '@supabase/supabase-js';

// Loaded on demand so the Supabase SDK is only downloaded in Supabase auth mode.
let client: SupabaseClient | null = null;

export async function initSupabase(url: string, anonKey: string): Promise<SupabaseClient> {
  if (client) return client;
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

export const supabase = () => client;

export async function accessToken(): Promise<string | null> {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}
