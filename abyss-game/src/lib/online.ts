import type { SupabaseClient } from '@supabase/supabase-js'
import type { GameMode } from '../engine/types'
import type { ProfileData } from '../state/profileTypes'

/**
 * Optional online layer (Supabase). Everything here is a no-op unless
 * VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set at build time.
 * The SDK is loaded lazily so offline players never download it.
 */
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const onlineConfigured = Boolean(URL && KEY)

let clientPromise: Promise<SupabaseClient> | null = null

async function client(): Promise<SupabaseClient> {
  if (!onlineConfigured) throw new Error('Online features are not configured.')
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(URL!, KEY!, { auth: { persistSession: true, autoRefreshToken: true } }),
    )
  }
  return clientPromise
}

/** Anonymous sign-in: a stable per-device identity with no email or password. */
async function ensureUser(): Promise<string> {
  const sb = await client()
  const { data } = await sb.auth.getSession()
  if (data.session?.user) return data.session.user.id
  const { data: signed, error } = await sb.auth.signInAnonymously()
  if (error || !signed.user) throw new Error(error?.message ?? 'Could not sign in anonymously. Enable anonymous sign-ins in Supabase Auth settings.')
  return signed.user.id
}

export interface OnlineScore {
  player_name: string
  mode: GameMode
  score: number
  correct: number
  total: number
  daily_key: string | null
  created_at: string
}

export async function submitOnlineScore(entry: {
  name: string
  mode: GameMode
  score: number
  correct: number
  total: number
  dailyKey?: string
}): Promise<void> {
  const sb = await client()
  const userId = await ensureUser()
  const { error } = await sb.from('scores').insert({
    user_id: userId,
    player_name: entry.name.slice(0, 20),
    mode: entry.mode,
    score: entry.score,
    correct: entry.correct,
    total: entry.total,
    daily_key: entry.dailyKey ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function fetchOnlineScores(mode: GameMode, dailyKey?: string, limit = 25): Promise<OnlineScore[]> {
  const sb = await client()
  let q = sb
    .from('scores')
    .select('player_name, mode, score, correct, total, daily_key, created_at')
    .eq('mode', mode)
    .order('score', { ascending: false })
    .limit(limit)
  if (mode === 'daily' && dailyKey) q = q.eq('daily_key', dailyKey)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as OnlineScore[]
}

export async function cloudSave(profile: ProfileData): Promise<void> {
  const sb = await client()
  const userId = await ensureUser()
  const { error } = await sb.from('profiles').upsert({ user_id: userId, data: profile, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}

export async function cloudLoad(): Promise<ProfileData | null> {
  const sb = await client()
  const userId = await ensureUser()
  const { data, error } = await sb.from('profiles').select('data').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.data as ProfileData) ?? null
}
