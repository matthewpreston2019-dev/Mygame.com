// =============================================================================
// coach-tick — the coach's clock. pg_cron calls this every minute.
// For each user it works out today's plan (in their time zone, DST-safe),
// finds messages that are due and not yet sent, writes them to the Coach feed
// and sends a push notification (if that type is switched on).
//
// Each message is unique per (user, date, key) in the database, so even if the
// scheduler runs twice or late, nothing is sent twice. A message that's late
// (scheduler hiccup) is still sent within a 90-minute window.
//
// Auth: header x-cron-secret must match app_secrets.cron_secret.
// Testing: POST { "dryRun": true, "now": "2026-10-21T12:35:00Z" } returns what
// would be sent at that moment without sending anything.
// =============================================================================
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { admin, json, getSecret, safeEqual } from '../_shared/http.ts';
import { sendToUser } from '../_shared/notify.ts';
import { dateInTz, minutesInTz, addDays, weekStart } from '../_shared/app/time.js';
import { mergeSettings } from '../_shared/app/defaults.js';
import { createStats } from '../_shared/app/stats.js';
import { dueMessages, composeMessage } from '../_shared/app/coach.js';

const HISTORY_DAYS = 90; // data loaded for summaries and reports
// The weekly report shows your current streak, which looks back up to 730
// days (stats.js), plus a week for the gym catch-up rule. Loaded once a week.
const STREAK_HISTORY_DAYS = 740;

// Supabase returns at most 1000 rows per request (the API's "max rows"
// setting), even with .limit(5000). So we read in pages of 1000. Keep PAGE
// at or below that setting.
const PAGE = 1000;
// A unique sort order per table, so pages never skip or repeat a row.
const ORDER: Record<string, string[]> = {
  foods: ['date', 'id'], study_sessions: ['date', 'id'], workouts: ['date', 'id'],
  quest_log: ['date', 'quest_id'],
  quests: ['id'], workout_templates: ['id'],
  // one row per day:
  steps: ['date'], checkins: ['date'], sleep_logs: ['date'], day_plans: ['date'], weights: ['date'], day_scores: ['date'],
};

/** How long a push may wait for a phone that's offline (seconds). "Gym in 30 min" is useless hours later. */
function pushTtl(key: string): number {
  if (key === 'plan' || key === 'summary' || key === 'weekly') return 12 * 3600;
  if (key === 'morning_exam') return 3 * 3600;
  return 30 * 60;
}

Deno.serve(async (req) => {
  const db = admin();
  const expected = await getSecret(db, 'cron_secret');
  const given = req.headers.get('x-cron-secret') || '';
  if (!expected || !safeEqual(given, expected)) return json({ error: 'forbidden' }, 403);

  const opts = await req.json().catch(() => ({}));
  const now = opts.now ? new Date(opts.now) : new Date();
  const dryRun = !!opts.dryRun;

  const { data: profiles, error } = await db.from('profiles').select('user_id, settings').eq('deleted', false);
  if (error) return json({ error: error.message }, 500);

  const results = [];
  for (const p of profiles || []) {
    try {
      results.push(await tickUser(db, p, now, dryRun));
    } catch (e) {
      console.error('tick failed for', p.user_id, e);
      results.push({ user: p.user_id, error: String(e) });
    }
  }
  return json({ ok: true, at: now.toISOString(), results });
});

/** All live rows of a table for a user (optionally within a date range), page by page. */
async function rows(db: SupabaseClient, table: string, userId: string, fromDate?: string, toDate?: string) {
  const out = [];
  for (let off = 0; ; off += PAGE) {
    // Build the query fresh for every page (query builders can't be reused).
    let q = db.from(table).select('*').eq('user_id', userId).eq('deleted', false);
    if (fromDate) q = q.gte('date', fromDate);
    if (toDate) q = q.lte('date', toDate);
    for (const col of ORDER[table] || ['id']) q = q.order(col);
    const { data, error } = await q.range(off, off + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out; // last page
  }
}

async function tickUser(db: SupabaseClient, profile: { user_id: string; settings: unknown }, now: Date, dryRun: boolean) {
  const uid = profile.user_id;
  const settings = mergeSettings(profile.settings);
  if (!settings.onboarded) return { user: uid, skipped: 'not onboarded' };

  const tz = settings.timezone;
  const date = dateInTz(tz, now);
  const nowMin = minutesInTz(tz, now);

  // ---- Stage 1 (cheap, every minute): is anything due? ----
  const ws = weekStart(date);
  const [dayPlans, weekWorkouts, sentToday] = await Promise.all([
    rows(db, 'day_plans', uid, date, addDays(date, 1)),
    rows(db, 'workouts', uid, ws, date),
    db.from('coach_messages').select('key').eq('user_id', uid).eq('date', date).then((r) => r.data || []),
  ]);
  const weekSets = weekWorkouts.length ? await setsFor(db, weekWorkouts.map((w) => w.id)) : [];
  const quick = createStats({ day_plans: dayPlans, workouts: weekWorkouts, workout_sets: weekSets }, settings, { today: date });
  const plan = quick.planFor(date);
  const sent = new Set(sentToday.map((m: { key: string }) => m.key));
  const due = dueMessages(plan, settings, nowMin, sent);
  if (!due.length) return { user: uid, date, due: 0 };

  // ---- Stage 2: load recent history and write the messages ----
  const from = addDays(date, due.some((m) => m.key === 'weekly') ? -STREAK_HISTORY_DAYS : -HISTORY_DAYS);
  const [foods, steps, study, workouts, checkins, sleep, quests, questLog, plans, weights, templates, dayScores] = await Promise.all([
    rows(db, 'foods', uid, from), rows(db, 'steps', uid, from), rows(db, 'study_sessions', uid, from),
    rows(db, 'workouts', uid, from), rows(db, 'checkins', uid, from), rows(db, 'sleep_logs', uid, from),
    // day_plans a week ahead: "next gym session" looks at the coming days' plans.
    rows(db, 'quests', uid), rows(db, 'quest_log', uid, from), rows(db, 'day_plans', uid, from, addDays(date, 8)),
    rows(db, 'weights', uid, from), rows(db, 'workout_templates', uid), rows(db, 'day_scores', uid, from),
  ]);
  const sets = workouts.length ? await setsFor(db, workouts.map((w) => w.id)) : [];
  const stats = createStats({
    foods, steps, study_sessions: study, workouts, workout_sets: sets, checkins, sleep_logs: sleep,
    quests, quest_log: questLog, day_plans: plans, weights, workout_templates: templates, day_scores: dayScores,
  }, settings, { today: date });
  const ctx = { lang: settings.language, settings, stats, date, templates };

  const out = [];
  for (const m of due) {
    // One broken message must not block the others (they'd be retried every
    // minute and the rest of the evening would never arrive).
    let msg;
    try { msg = composeMessage(m.key, ctx); } catch (e) {
      console.error('compose failed', m.key, e);
      out.push({ key: m.key, error: String(e) });
      continue;
    }
    if (!msg) {
      // Not needed after all (e.g. goal already hit). Record it so we don't re-check all window.
      if (!dryRun) await db.from('coach_messages').insert({ user_id: uid, date, key: m.key, kind: 'coach', body: '', data: { type: 'skipped' }, deleted: true, read_at: now.toISOString() });
      out.push({ key: m.key, skipped: true });
      continue;
    }
    if (dryRun) { out.push({ key: m.key, title: msg.title, body: msg.body }); continue; }

    const { error } = await db.from('coach_messages').insert({ user_id: uid, date, key: m.key, kind: 'coach', body: msg.body, data: msg.data });
    if (error) {
      if (error.code === '23505') { out.push({ key: m.key, duplicate: true }); continue; } // another run already sent it
      throw error;
    }
    let push = null;
    if (settings.notify[m.pref] !== false) {
      const { count } = await db.from('coach_messages').select('id', { count: 'exact', head: true })
        .eq('user_id', uid).eq('kind', 'coach').eq('deleted', false).is('read_at', null);
      const r = await sendToUser(db, uid, { title: msg.title, body: msg.body, url: './#/coach', tag: m.key, badge: count ?? undefined }, { ttl: pushTtl(m.key) });
      push = { sent: r.sent, failed: r.failed };
    }
    out.push({ key: m.key, sent: true, push });
  }
  return { user: uid, date, time: `${Math.floor(nowMin / 60)}:${String(nowMin % 60).padStart(2, '0')}`, messages: out };
}

/** All live sets of these workouts. */
async function setsFor(db: SupabaseClient, ids: string[]) {
  const out = [];
  // Keep URLs short: query in chunks of 150 workouts, each read page by page.
  for (let i = 0; i < ids.length; i += 150) {
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await db.from('workout_sets').select('*').in('workout_id', ids.slice(i, i + 150)).eq('deleted', false)
        .order('id').range(off, off + PAGE - 1);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < PAGE) break; // last page of this chunk
    }
  }
  return out;
}
