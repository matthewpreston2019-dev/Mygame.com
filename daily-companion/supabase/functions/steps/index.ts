// =============================================================================
// steps — receives today's step count from the iOS Shortcut (Apple Health).
//
//   POST https://<project>.supabase.co/functions/v1/steps
//   Header  x-steps-token: <your token from Settings → Steps from Apple Health>
//   JSON    { "steps": 8123 }            optional: "date": "2026-10-21"
//
// (GET ?token=…&steps=… also works, handy for testing in a browser.)
// The token can only write steps — it can't read anything.
// =============================================================================
import { admin, json, preflight } from '../_shared/http.ts';
import { dateInTz, addDays, isDateStr } from '../_shared/app/time.js';
import { mergeSettings } from '../_shared/app/defaults.js';

/**
 * Accepts 8123, "8123", "8.123" / "8,123" / "8 123" (thousands), "8123.0".
 * A missing or empty value is NaN (an error), never 0 — otherwise a failed
 * Health read would wipe the day's real count.
 */
export function parseSteps(v: unknown): number {
  if (v == null) return NaN;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).trim().replace(/[\s'  ]/g, '');
  if (s === '') return NaN;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST' && req.method !== 'GET') return json({ ok: false, error: 'Use POST' }, 405);

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    const type = req.headers.get('content-type') || '';
    try {
      if (type.includes('application/json')) body = await req.json();
      else if (type.includes('form')) body = Object.fromEntries((await req.formData()).entries());
      else { const txt = await req.text(); body = txt.trim().startsWith('{') ? JSON.parse(txt) : { steps: txt }; }
    } catch { return json({ ok: false, error: 'Could not read the request body' }, 400); }
  }
  const token = req.headers.get('x-steps-token') || String(body.token || url.searchParams.get('token') || '');
  const rawSteps = body.steps ?? url.searchParams.get('steps');
  const rawDate = String(body.date || url.searchParams.get('date') || '');
  if (!token) return json({ ok: false, error: 'Missing x-steps-token header' }, 401);

  const db = admin();
  const { data: profile, error } = await db.from('profiles').select('user_id, settings').eq('steps_token', token).eq('deleted', false).maybeSingle();
  if (error) { console.error(error); return json({ ok: false, error: 'Server error' }, 500); }
  if (!profile) return json({ ok: false, error: 'Invalid token — copy it again from the app' }, 401);

  if (rawSteps == null || String(rawSteps).trim() === '') {
    return json({ ok: false, error: 'Missing steps — send { "steps": 8123 } (nothing was saved)' }, 400);
  }
  const steps = parseSteps(rawSteps);
  if (!Number.isInteger(steps) || steps < 0 || steps > 200000) return json({ ok: false, error: `Steps must be a number from 0 to 200000 (got "${String(rawSteps).slice(0, 30)}")` }, 400);

  const settings = mergeSettings(profile.settings);
  const today = dateInTz(settings.timezone);
  const date = rawDate ? rawDate : today;
  if (!isDateStr(date) || date < addDays(today, -7) || date > addDays(today, 1)) return json({ ok: false, error: 'date must be YYYY-MM-DD within the last 7 days' }, 400);

  // A 0 for a day that already has steps is a failed read (e.g. the Shortcut
  // ran while the phone was locked and Health couldn't be read): keep the
  // stored number, whether it came from the Shortcut or was typed in. Any other
  // number replaces it, also a lower one (e.g. after fixing a Shortcut that
  // counted iPhone and Watch twice). You can always correct a day in the app.
  const { data: existing, error: readErr } = await db.from('steps').select('steps, source, deleted')
    .eq('user_id', profile.user_id).eq('date', date).maybeSingle();
  if (readErr) { console.error(readErr); return json({ ok: false, error: 'Server error' }, 500); }
  if (steps === 0 && existing && !existing.deleted && existing.steps > 0) {
    const kept = existing.steps;
    return json({ ok: true, date, steps: kept, kept: true, received: steps, goal: settings.targets.steps, goalReached: kept >= settings.targets.steps });
  }

  const { error: upErr } = await db.from('steps').upsert({ user_id: profile.user_id, date, steps, source: 'shortcut', deleted: false }, { onConflict: 'user_id,date' });
  if (upErr) { console.error(upErr); return json({ ok: false, error: 'Could not save' }, 500); }
  return json({ ok: true, date, steps, goal: settings.targets.steps, goalReached: steps >= settings.targets.steps });
});
