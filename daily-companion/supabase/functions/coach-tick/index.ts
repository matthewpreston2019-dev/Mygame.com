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

const HISTORY_DAYS = 90; // data loaded for summaries, reports and streaks

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

async function rows(db: SupabaseClient, table: string, userId: string, fromDate?: string, toDate?: string) {
  let q = db.from(table).select('*').eq('user_id', userId).eq('deleted', false);
  if (fromDate) q = q.gte('date', fromDate);
  if (toDate) q = q.lte('date', toDate);
  const { data, error } = await q.limit(5000);
  if (error) throw error;
  return data || [];
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
  const weekSets = weekWorkouts.length
    ? (await db.from('workout_sets').select('*').in('workout_id', weekWorkouts.map((w) => w.id)).eq('deleted', false)).data || []
    : [];
  const quick = createStats({ day_plans: dayPlans, workouts: weekWorkouts, workout_sets: weekSets }, settings);
  const plan = quick.planFor(date);
  const sent = new Set(sentToday.map((m: { key: string }) => m.key));
  const due = dueMessages(plan, settings, nowMin, sent);
  if (!due.length) return { user: uid, date, due: 0 };

  // ---- Stage 2: load recent history and write the messages ----
  const from = addDays(date, -HISTORY_DAYS);
  const [foods, steps, study, workouts, checkins, sleep, quests, questLog, plans, weights, templates] = await Promise.all([
    rows(db, 'foods', uid, from), rows(db, 'steps', uid, from), rows(db, 'study_sessions', uid, from),
    rows(db, 'workouts', uid, from), rows(db, 'checkins', uid, from), rows(db, 'sleep_logs', uid, from),
    rows(db, 'quests', uid), rows(db, 'quest_log', uid, from), rows(db, 'day_plans', uid, from, addDays(date, 2)),
    rows(db, 'weights', uid, from), rows(db, 'workout_templates', uid),
  ]);
  const sets = workouts.length ? await setsFor(db, workouts.map((w) => w.id)) : [];
  const stats = createStats({
    foods, steps, study_sessions: study, workouts, workout_sets: sets, checkins, sleep_logs: sleep,
    quests, quest_log: questLog, day_plans: plans, weights, workout_templates: templates,
  }, settings);
  const ctx = { lang: settings.language, settings, stats, date, templates };

  const out = [];
  for (const m of due) {
    const msg = composeMessage(m.key, ctx);
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
      const r = await sendToUser(db, uid, { title: msg.title, body: msg.body, url: './#/coach', tag: m.key, badge: count ?? undefined });
      push = { sent: r.sent, failed: r.failed };
    }
    out.push({ key: m.key, sent: true, push });
  }
  return { user: uid, date, time: `${Math.floor(nowMin / 60)}:${String(nowMin % 60).padStart(2, '0')}`, messages: out };
}

async function setsFor(db: SupabaseClient, ids: string[]) {
  const out = [];
  // Keep URLs short: query in chunks.
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await db.from('workout_sets').select('*').in('workout_id', ids.slice(i, i + 150)).eq('deleted', false);
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}
