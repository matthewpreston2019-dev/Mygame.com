// Unit tests for the shared logic (planner, time zones, stats, coach).
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import * as time from '../web/js/shared/time.js';
import { DEFAULT_SETTINGS, mergeSettings, suggestTargets } from '../web/js/shared/defaults.js';
import { buildDayPlan, gymWeekInfo } from '../web/js/shared/plan.js';
import { createStats, levelFromXp } from '../web/js/shared/stats.js';
import { messageSchedule, dueMessages, composeMessage, summaryText, weeklyText, checkinReply, fill } from '../web/js/shared/coach.js';
import { TEXT } from '../web/js/shared/coach-text.js';
import { shortenText } from '../supabase/functions/_shared/webpush.js';
// The server's copies (made by scripts/sync-shared.mjs) — the Edge Function tests use these.
import * as appTime from '../supabase/functions/_shared/app/time.js';
import * as appDefaults from '../supabase/functions/_shared/app/defaults.js';
import * as appStats from '../supabase/functions/_shared/app/stats.js';
import * as appCoach from '../supabase/functions/_shared/app/coach.js';

const S = mergeSettings({ onboarded: true });
const TZ = 'Europe/Berlin';
const block = (plan, kind) => plan.blocks.find((b) => b.kind === kind);

// ---- time --------------------------------------------------------------------
test('Berlin dates and minutes', () => {
  // 2026-10-20 22:30 UTC = 2026-10-21 00:30 in Berlin (CEST, +2)
  const i = new Date('2026-10-20T22:30:00Z');
  assert.equal(time.dateInTz(TZ, i), '2026-10-21');
  assert.equal(time.minutesInTz(TZ, i), 30);
});

test('wall time → instant across DST (spring forward and fall back)', () => {
  // Winter (CET, +1): 15:00 Berlin = 14:00 UTC
  assert.equal(time.zonedTimeToDate('2026-01-15', '15:00', TZ).toISOString(), '2026-01-15T14:00:00.000Z');
  // Summer (CEST, +2): 15:00 Berlin = 13:00 UTC
  assert.equal(time.zonedTimeToDate('2026-07-15', '15:00', TZ).toISOString(), '2026-07-15T13:00:00.000Z');
  // DST change days: 29 Mar 2026 (spring) and 25 Oct 2026 (fall)
  assert.equal(time.zonedTimeToDate('2026-03-29', '22:30', TZ).toISOString(), '2026-03-29T20:30:00.000Z');
  assert.equal(time.zonedTimeToDate('2026-03-29', '01:30', TZ).toISOString(), '2026-03-29T00:30:00.000Z');
  assert.equal(time.zonedTimeToDate('2026-10-25', '22:30', TZ).toISOString(), '2026-10-25T21:30:00.000Z');
  assert.equal(time.zonedTimeToDate('2026-10-25', '00:30', TZ).toISOString(), '2026-10-24T22:30:00.000Z');
  // The skipped hour (02:30 doesn't exist on 29 Mar) lands an hour later, not on another day.
  const gap = time.zonedTimeToDate('2026-03-29', '02:30', TZ);
  assert.equal(time.dateInTz(TZ, gap), '2026-03-29');
});

test('date helpers', () => {
  assert.equal(time.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(time.addDays('2026-03-29', 1), '2026-03-30'); // DST day has 23 h; date math unaffected
  assert.equal(time.weekdayOf('2026-10-21'), 3); // Wednesday
  assert.equal(time.weekStart('2026-10-25'), '2026-10-19'); // Sunday → Monday
  assert.equal(time.toHHMM(time.toMinutes('22:30') + 90), '00:00');
  assert.ok(Number.isNaN(time.toMinutes('25:00')));
  assert.equal(time.isDateStr('2026-02-30'), false);
});

// ---- settings ----------------------------------------------------------------
test('mergeSettings keeps defaults and replaces arrays', () => {
  const m = mergeSettings({ schedule: { order: ['study', 'gym', 'relax'], freeFrom: { short: '15:00' } } });
  assert.deepEqual(m.schedule.order, ['study', 'gym', 'relax']);
  assert.equal(m.schedule.freeFrom.short, '15:00');
  assert.equal(m.schedule.freeFrom.long, '17:00');
  assert.equal(m.targets.goalWeight, 69);
});

test('suggestTargets: recomp numbers are sane', () => {
  const s = suggestTargets({ weight: 78, height: 180, age: 17, sex: 'male', activity: 1.55, deficit: 400 }, 69);
  assert.ok(s.kcal > 2000 && s.kcal < 2800, `kcal ${s.kcal}`);
  assert.equal(s.protein, 140); // 2 g × 69 kg, rounded to 5
  assert.equal(suggestTargets({ weight: 78 }, 69), null);
});

// ---- planner ------------------------------------------------------------------
test('short day: relax → gym → refuel → study, done by check-in', () => {
  const p = buildDayPlan({ date: '2026-10-19', settings: S }); // Monday
  assert.equal(p.type, 'short');
  assert.equal(p.gym, 'upper');
  assert.equal(p.studyGoal, 120);
  assert.deepEqual(p.blocks.filter((b) => ['relax', 'gym', 'refuel', 'study'].includes(b.kind)).map((b) => [b.kind, b.start, b.end]), [
    ['relax', '14:30', '15:30'], ['gym', '15:30', '16:45'], ['refuel', '16:45', '17:30'], ['study', '17:30', '19:30'],
  ]);
  assert.ok(block(p, 'study').endMin <= time.toMinutes('21:00'));
});

test('long day: light 45 min review, no gym', () => {
  const p = buildDayPlan({ date: '2026-10-20', settings: S }); // Tuesday
  assert.equal(p.type, 'long');
  assert.equal(p.gym, null);
  assert.equal(p.studyGoal, 45);
  assert.equal(block(p, 'study').start, '18:00');
});

test('split rotation Mon/Wed/Fri = Upper/Lower/Upper', () => {
  assert.equal(buildDayPlan({ date: '2026-10-21', settings: S }).gym, 'lower');
  assert.equal(buildDayPlan({ date: '2026-10-23', settings: S }).gym, 'upper');
});

test('exam tomorrow → exam prep; long day gets 60 min', () => {
  const p = buildDayPlan({ date: '2026-10-20', settings: S, nextOverride: { exam: { subject: 'Math', time: '09:00' } } });
  assert.equal(p.examTomorrow.subject, 'Math');
  assert.equal(p.studyGoal, 60);
  assert.equal(block(p, 'study').focus, 'Math');
});

test('exam today → exam block, half study', () => {
  const p = buildDayPlan({ date: '2026-10-21', settings: S, override: { exam: { subject: 'Bio', time: '10:00' } } });
  assert.equal(block(p, 'exam').start, '10:00');
  assert.equal(p.studyGoal, 60);
});

test('late finish trims the plan honestly (gym moved, study kept)', () => {
  const p = buildDayPlan({ date: '2026-10-19', settings: S, override: { free_from: '18:30' } });
  assert.equal(p.trimmed, true);
  assert.equal(p.gymMoved, true);
  assert.equal(p.gym, null);
  assert.ok(block(p, 'study').endMin <= time.toMinutes('21:00'));
  assert.equal(p.studyGoal, 120);
});

test('free_from 17:00 on short day keeps gym, shortens study', () => {
  const p = buildDayPlan({ date: '2026-10-19', settings: S, override: { free_from: '17:00' } });
  assert.equal(p.gym, 'upper');
  assert.equal(p.trimmed, true);
  assert.ok(p.studyGoal >= 30 && p.studyGoal < 120);
  assert.ok(block(p, 'study').endMin <= time.toMinutes('21:00'));
});

test('rest day and skip toggles', () => {
  const r = buildDayPlan({ date: '2026-10-19', settings: S, override: { day_type: 'rest' } });
  assert.equal(r.gym, null);
  assert.equal(r.studyGoal, 0);
  const sk = buildDayPlan({ date: '2026-10-19', settings: S, override: { skip_gym: true } });
  assert.equal(sk.gym, null);
  assert.equal(block(sk, 'gym'), undefined);
});

test('weekend catch-up when behind on gym', () => {
  const workouts = [{ date: '2026-10-19' }]; // only Monday done
  const gw = gymWeekInfo('2026-10-24', S, workouts); // Saturday
  assert.equal(gw.behind, 2);
  assert.equal(gw.nextSplit, 'lower');
  const p = buildDayPlan({ date: '2026-10-24', settings: S, gymWeek: gw });
  assert.equal(p.gymCatchUp, true);
  assert.equal(block(p, 'gym').start, '15:00');
  // Up to date → no catch-up
  const full = gymWeekInfo('2026-10-24', S, [{ date: '2026-10-19' }, { date: '2026-10-21' }, { date: '2026-10-23' }]);
  assert.equal(buildDayPlan({ date: '2026-10-24', settings: S, gymWeek: full }).gymCatchUp, false);
});

test('deleted override is ignored', () => {
  const p = buildDayPlan({ date: '2026-10-19', settings: S, override: { day_type: 'rest', deleted: true } });
  assert.equal(p.type, 'short');
});

// ---- stats --------------------------------------------------------------------
function data(extra = {}) {
  return {
    quests: [
      { id: 'q1', key: 'pushups', kind: 'manual', xp: 10, days: [0, 1, 2, 3, 4, 5, 6], sort: 1, active: true },
      { id: 'q2', key: 'study', kind: 'study', xp: 30, days: [0, 1, 2, 3, 4, 5, 6], sort: 2, active: true },
      { id: 'q3', key: 'steps', kind: 'steps', xp: 20, days: [0, 1, 2, 3, 4, 5, 6], sort: 3, active: true },
      { id: 'q4', key: 'gym', kind: 'workout', xp: 40, days: [1, 3, 5], sort: 4, active: true },
    ],
    ...extra,
  };
}

test('levels', () => {
  assert.equal(levelFromXp(0).level, 1);
  assert.equal(levelFromXp(99).level, 1);
  assert.equal(levelFromXp(100).level, 2);
  assert.equal(levelFromXp(300).level, 3);
  assert.equal(levelFromXp(1000).level, 5);
});

test('quests complete from data; workout needs a ticked set', () => {
  const d = '2026-10-19';
  const st = createStats(data({
    study_sessions: [{ id: 's', date: d, minutes: 120 }],
    steps: [{ date: d, steps: 9000 }],
    workouts: [{ id: 'w1', date: d }],
    workout_sets: [{ id: 'x', workout_id: 'w1', done: false, reps: 8, weight: 50 }],
    quest_log: [{ quest_id: 'q1', date: d, xp: 10 }],
  }), S);
  const q = Object.fromEntries(st.questsFor(d).map((x) => [x.quest.id, x]));
  assert.equal(q.q1.done, true);
  assert.equal(q.q2.done, true);
  assert.equal(q.q3.done, true);
  assert.equal(q.q4.done, false); // set not ticked
  const st2 = createStats(data({ workouts: [{ id: 'w1', date: d }], workout_sets: [{ id: 'x', workout_id: 'w1', done: true, reps: 8, weight: 50 }] }), S);
  assert.equal(st2.questsFor(d).find((x) => x.quest.id === 'q4').done, true);
});

test('workout quest not applicable on long day', () => {
  const st = createStats(data(), S);
  const q = st.questsFor('2026-10-20').find((x) => x.quest.id === 'q4');
  assert.equal(q.applicable, false);
});

test('streak: unfinished today never breaks it; a weak day does', () => {
  const logs = [];
  for (const d of ['2026-10-17', '2026-10-18', '2026-10-19']) logs.push({ quest_id: 'q1', date: d, xp: 10 });
  const extra = {
    quest_log: logs,
    study_sessions: ['2026-10-17', '2026-10-18', '2026-10-19'].map((d, i) => ({ id: 's' + i, date: d, minutes: 120 })),
    steps: ['2026-10-17', '2026-10-18', '2026-10-19'].map((d) => ({ date: d, steps: 9000 })),
    workouts: [{ id: 'w1', date: '2026-10-19' }],
    workout_sets: [{ id: 'x', workout_id: 'w1', done: true, reps: 8, weight: 50 }],
  };
  const st = createStats(data(extra), S);
  assert.equal(st.streak('2026-10-20'), 3); // Tue not done yet → still 3
  assert.equal(st.bestStreak('2026-10-20'), 3);
});

test('finished days are frozen: later settings changes do not rewrite them', () => {
  const tue = '2026-10-20';
  const logs = ['q1', 'q2', 'q3'].map((id) => ({ quest_id: id, date: tue, xp: 10 }));
  const snap = { date: tue, quest_ids: ['q1', 'q2', 'q3'], updated_at: '2026-10-21T08:00:00.000Z' };
  const gymOnTue = mergeSettings({ schedule: { gymDays: { 2: 'upper' } } }); // gym moved onto Tuesdays
  const opts = { today: '2026-10-22' };
  const live = createStats(data({ quest_log: logs }), gymOnTue, opts);
  assert.equal(live.completion(tue).applicable, 4); // no snapshot: judged by today's gym days
  const frozen = createStats(data({ quest_log: logs, day_scores: [snap] }), gymOnTue, opts);
  assert.deepEqual([frozen.completion(tue).done, frozen.completion(tue).applicable], [3, 3]);
  // A log removed later lowers it; re-planning that day afterwards makes it live again.
  const unticked = createStats(data({ quest_log: logs.slice(1), day_scores: [snap] }), gymOnTue, opts);
  assert.deepEqual([unticked.completion(tue).done, unticked.completion(tue).applicable], [2, 3]);
  const replanned = createStats(data({ quest_log: logs, day_scores: [snap], day_plans: [{ date: tue, day_type: 'short', updated_at: '2026-10-21T09:00:00+00:00' }] }), gymOnTue, opts);
  assert.equal(replanned.completion(tue).applicable, 4);
  // Today is never frozen.
  assert.equal(createStats(data({ day_scores: [{ ...snap, date: '2026-10-22' }] }), gymOnTue, opts).completion('2026-10-22').applicable,
    live.liveCompletion('2026-10-22').applicable);
});

test('sleep score needs 3 nights and rewards consistency', () => {
  const mk = (date, bed, wake) => ({
    date,
    slept_at: time.zonedTimeToDate(time.addDays(date, -1), bed, TZ).toISOString(),
    woke_at: time.zonedTimeToDate(date, wake, TZ).toISOString(),
  });
  const two = createStats({ sleep_logs: [mk('2026-10-19', '22:30', '07:00'), mk('2026-10-20', '22:30', '07:00')] }, S);
  assert.equal(two.sleepScore('2026-10-20').score, null);
  const perfect = createStats({ sleep_logs: ['2026-10-18', '2026-10-19', '2026-10-20'].map((d) => mk(d, '22:30', '07:00')) }, S);
  assert.equal(perfect.sleepScore('2026-10-20').score, 100);
  // Bedtimes either side of midnight are handled (23:30 vs 00:30 = 1 h apart).
  const messy = createStats({ sleep_logs: [mk('2026-10-18', '23:30', '07:00'), mk('2026-10-19', '22:00', '07:00'), { date: '2026-10-20', slept_at: time.zonedTimeToDate('2026-10-20', '00:30', TZ).toISOString(), woke_at: time.zonedTimeToDate('2026-10-20', '08:30', TZ).toISOString() }] }, S);
  const sc = messy.sleepScore('2026-10-20');
  assert.ok(sc.score < 80 && sc.score > 20, `score ${sc.score}`);
  assert.equal(sc.onTimeNights, 1);
});

// ---- coach --------------------------------------------------------------------
test('message schedule for a short day', () => {
  const p = buildDayPlan({ date: '2026-10-19', settings: S });
  const sched = messageSchedule(p, S).map((m) => `${m.key}@${time.toHHMM(m.atMin)}`);
  assert.deepEqual(sched, ['plan@14:30', 'gym@15:00', 'study_start@17:30', 'study_end@19:30', 'nudge_gym@20:00', 'nudge_study@20:15', 'checkin@21:00', 'summary@21:30', 'winddown@22:00']);
});

test('weekly report only on Sunday; morning message on exam day', () => {
  const sun = buildDayPlan({ date: '2026-10-25', settings: S });
  assert.ok(messageSchedule(sun, S).some((m) => m.key === 'weekly'));
  const exam = buildDayPlan({ date: '2026-10-21', settings: S, override: { exam: { subject: 'Bio', time: '08:00' } } });
  assert.equal(messageSchedule(exam, S).find((m) => m.key === 'morning_exam').atMin, time.toMinutes('07:00'));
});

test('due window: sent once, catches up after a late scheduler', () => {
  const p = buildDayPlan({ date: '2026-10-19', settings: S });
  assert.deepEqual(dueMessages(p, S, time.toMinutes('14:29'), new Set()).map((m) => m.key), []);
  assert.deepEqual(dueMessages(p, S, time.toMinutes('14:45'), new Set()).map((m) => m.key), ['plan']);
  assert.deepEqual(dueMessages(p, S, time.toMinutes('14:45'), new Set(['plan'])).map((m) => m.key), []);
  // At 16:01 the 14:30 plan is past its 90-min window; the 15:00 gym reminder is not.
  assert.deepEqual(dueMessages(p, S, time.toMinutes('16:01'), new Set()).map((m) => m.key), ['gym']);
});

test('composed messages are honest and skip when not needed', () => {
  const d = '2026-10-19';
  const templates = [{ id: 't1', key: 'upper', exercises: [{ id: 'bench', sets: 3, reps: '6-8' }] }];
  const prev = { id: 'w0', date: '2026-10-16', template_id: 't1', started_at: '2026-10-16T14:00:00Z' };
  const st = createStats({ ...data(), workouts: [prev], workout_sets: [{ id: 'a', workout_id: 'w0', exercise: 'bench', done: true, reps: 8, weight: 60 }, { id: 'b', workout_id: 'w0', exercise: 'bench', done: true, reps: 7, weight: 62.5 }] }, S);
  const ctx = { lang: 'en', settings: S, stats: st, date: d, templates };
  const gym = composeMessage('gym', ctx);
  assert.match(gym.body, /Upper/);
  assert.match(gym.body, /Bench press 62\.5 kg × 7/);
  const plan = composeMessage('plan', ctx);
  assert.match(plan.body, /14:30\s+Relax & eat/);
  assert.match(plan.body, /15:30\s+Gym · Upper/);
  assert.match(plan.body, /17:30\s+Study · 2 h/);
  const nudge = composeMessage('nudge_study', ctx);
  assert.match(nudge.body, /No study logged/);
  // Study goal already met → no study reminder
  const st2 = createStats({ ...data(), study_sessions: [{ id: 's', date: d, minutes: 130 }] }, S);
  assert.equal(composeMessage('study_start', { ...ctx, stats: st2 }), null);
  assert.equal(composeMessage('nudge_study', { ...ctx, stats: st2 }), null);
});

test('every coach message composes in every language (no missing text, no leftover {placeholders})', () => {
  const KEYS = ['plan', 'morning_exam', 'gym', 'study_start', 'study_end', 'nudge_gym', 'nudge_study', 'checkin', 'summary', 'winddown', 'weekly'];
  const templates = [{ id: 't1', key: 'upper', exercises: [{ id: 'bench', sets: 3, reps: '6-8' }] }, { id: 't2', key: 'lower', exercises: [{ id: 'squat', sets: 3, reps: '6-8' }] }];
  // Mon short day, Tue long day with an exam the next day, Wed exam day, Sun (weekly report).
  const plans = [{ date: '2026-10-21', exam: { subject: 'Bio', time: '08:00' } }];
  const st = createStats({ ...data(), day_plans: plans }, S);
  for (const lang of Object.keys(TEXT)) {
    for (const date of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-25']) {
      const ctx = { lang, settings: S, stats: st, date, templates };
      for (const key of KEYS) {
        const msg = composeMessage(key, ctx); // must not throw
        if (msg === null) continue; // not needed that day
        assert.ok(msg.title && msg.body, `${lang} ${date} ${key}: empty`);
        assert.doesNotMatch(msg.body, /\{\w+\}|undefined|NaN/, `${lang} ${date} ${key}: ${msg.body}`);
      }
    }
  }
  const wd = (date) => composeMessage('winddown', { lang: 'en', settings: S, stats: st, date, templates }).body;
  assert.match(wd('2026-10-20'), /Exam tomorrow.*22:30/);
  assert.match(wd('2026-10-19'), /Lights out at 22:30/);
});

test('summary names misses honestly', () => {
  const d = '2026-10-19';
  const st = createStats({ ...data(), study_sessions: [{ id: 's', date: d, minutes: 30 }], foods: [{ id: 'f', date: d, kcal: 1800, protein: 90, eaten_at: '2026-10-19T10:00:00Z' }] }, S);
  const txt = summaryText(st.summary(d), { lang: 'en', settings: S });
  assert.match(txt, /⚠️ Study 30 min \/ 2 h/);
  assert.match(txt, /❌ Gym planned, not logged/);
  assert.match(txt, /❌ 1,800 \/ 2,200 kcal · 90 \/ 140 g protein/);
  assert.match(txt, /Steps not synced yet/);
  assert.doesNotMatch(txt, /Every goal hit/);
});

test('weekly report text is complete and not fake-positive', () => {
  const st = createStats(data({ study_sessions: [{ id: 's', date: '2026-10-19', minutes: 60 }] }), S);
  const r = st.week('2026-10-19', '2026-10-25');
  assert.equal(r.gym.planned, 3);
  assert.equal(r.gym.done, 0);
  const txt = weeklyText(r, { lang: 'en', settings: S });
  assert.match(txt, /Gym: 0\/3 sessions/);
  assert.match(txt, /Next week, focus on/);
});

test('check-in reply mentions the next session', () => {
  const st = createStats(data(), S);
  const reply = checkinReply({ trained: false }, { lang: 'en', settings: S, stats: st, date: '2026-10-19' });
  assert.match(reply, /Next session: Wednesday/);
});

test('all coach languages have the same placeholders as English', () => {
  const vars = (v) => [...new Set(JSON.stringify(v).match(/\{\w+\}/g) || [])].sort().join(',');
  const walk = (a, b, path) => {
    for (const [k, v] of Object.entries(a)) {
      const p = `${path}.${k}`;
      assert.ok(b && b[k] !== undefined, `missing ${p}`);
      if (typeof v === 'object') walk(v, b[k], p);
      else assert.equal(vars(b[k]), vars(v), `placeholders differ at ${p}`);
    }
  };
  for (const lang of ['es', 'de', 'ru', 'zh', 'ar']) walk(TEXT.en, TEXT[lang], lang);
  assert.equal(fill('{n} kcal', { n: 1800 }, 'de'), '1.800 kcal');
});

// ---- history stays put (past days, quests, targets) ---------------------------
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const manual = (id, extra = {}) => ({ id, kind: 'manual', xp: 10, days: ALL_DAYS, sort: 1, active: true, ...extra });

test('adding or switching off quests does not rewrite past days', () => {
  const today = '2026-10-21';
  const past = time.dateRange('2026-10-14', '2026-10-20');
  const logs = past.map((d) => ({ quest_id: 'm1', date: d, xp: 10 }));
  assert.equal(createStats({ quests: [manual('m1')], quest_log: logs }, S, { today }).streak(today), 7);
  // Two quests added today: earlier days aren't judged against them.
  const added = [manual('m1'), manual('m2', { created_at: '2026-10-21T08:00:00Z' }), manual('m3', { created_at: '2026-10-21T08:00:00Z' })];
  const st = createStats({ quests: added, quest_log: logs }, S, { today });
  assert.equal(st.streak(today), 7);
  assert.equal(st.questsFor(today).length, 3); // ...but they count from today on
  // Switching off a quest you kept missing doesn't turn the past into wins.
  const off = [manual('m1'), manual('m4', { active: false, inactive_since: today })];
  const st2 = createStats({ quests: off, quest_log: logs }, S, { today });
  assert.equal(st2.completion('2026-10-20').ratio, 0.5);
  assert.equal(st2.streak(today), 0);
  assert.deepEqual(st2.questsFor(today).map((q) => q.quest.id), ['m1']); // gone from today
});

test('raising a target or changing quest days later keeps past XP; today follows the data', () => {
  const today = '2026-10-21';
  const yesterday = '2026-10-20';
  const q = [{ id: 's', kind: 'steps', xp: 20, days: ALL_DAYS, sort: 1, active: true }];
  const steps = [{ date: yesterday, steps: 9000 }, { date: today, steps: 9000 }];
  const logs = [{ quest_id: 's', date: yesterday, xp: 20 }, { quest_id: 's', date: today, xp: 20 }];
  const higher = mergeSettings({ onboarded: true, targets: { steps: 10000 } });
  const st = createStats({ quests: q, steps, quest_log: logs }, higher, { today });
  assert.equal(st.questsFor(yesterday)[0].done, true); // earned under the old target → stays earned
  assert.equal(st.questsFor(today)[0].done, false); // today: 9,000 < 10,000 → reconcile takes it back
  // Tuesday removed from the quest's days later: last Tuesday still counts as done.
  const noTue = [{ ...q[0], days: [0, 1, 3, 4, 5, 6] }];
  const st2 = createStats({ quests: noTue, steps, quest_log: logs }, S, { today });
  assert.deepEqual([st2.questsFor(yesterday)[0].applicable, st2.questsFor(yesterday)[0].done], [true, true]);
  // A past day without an XP entry is still judged by its data (e.g. app not opened that day).
  assert.equal(createStats({ quests: q, steps, quest_log: [] }, S, { today }).questsFor(yesterday)[0].done, true);
});

// ---- reports -------------------------------------------------------------------
const EN = { lang: 'en', settings: S };

test('daily summary: no food logged is a miss, not "Every goal hit"', () => {
  const sm = { studyGoal: 120, studyMin: 120, gymPlanned: true, gymDone: true, foodsLogged: 0, kcal: 0, protein: 0, kcalTarget: 2200, proteinTarget: 140, steps: null, stepsGoal: 8000 };
  const txt = summaryText(sm, EN);
  assert.doesNotMatch(txt, /Every goal hit/);
  assert.match(txt, /Fix tomorrow: food logging/);
  // A rest day with nothing logged at all: "can't judge", not "off day".
  assert.match(summaryText({ ...sm, studyGoal: 0, studyMin: 0, gymPlanned: false, gymDone: false }, EN), /Not much logged today/);
});

test('weekly steps: one synced day is flagged, not "your best area"', () => {
  const r = {
    daysCounted: 7,
    study: { minutes: 400, goal: 570, daysHit: 2, daysPlanned: 7 },
    gym: { done: 3, planned: 3 },
    food: { loggedDays: 7, avgKcal: 2200, avgProtein: 140, kcalTarget: 2200, proteinTarget: 140 },
    steps: { avg: 16000, goal: 8000, loggedDays: 1, daysHit: 1 },
    sleep: { score: null, nights: 0 }, weight: { change: null }, streak: 0,
  };
  const txt = weeklyText(r, EN);
  assert.match(txt, /hit 1\/7 days/);
  assert.match(txt, /Steps synced on only 1 of 7 days/);
  assert.match(txt, /Good week/);
  assert.doesNotMatch(txt, /best area was steps/);
  // Enough synced days → steps count again.
  assert.match(weeklyText({ ...r, steps: { ...r.steps, loggedDays: 5 } }, EN), /best area was steps/);
});

test('a week in progress is judged on the days so far (gym, sleep)', () => {
  const mon = '2026-10-19';
  const night = (date) => ({ date, slept_at: time.zonedTimeToDate(time.addDays(date, -1), '22:30', TZ).toISOString(), woke_at: time.zonedTimeToDate(date, '07:00', TZ).toISOString() });
  const st = createStats({
    ...data(),
    workouts: [{ id: 'w', date: mon }], workout_sets: [{ id: 'x', workout_id: 'w', done: true, reps: 8, weight: 50 }],
    study_sessions: [{ id: 's', date: mon, minutes: 120 }],
    foods: [{ id: 'f', date: mon, kcal: 2200, protein: 140, eaten_at: '2026-10-19T12:00:00Z' }],
    steps: [{ date: mon, steps: 9000 }],
    sleep_logs: ['2026-10-16', '2026-10-17', '2026-10-18', mon].map(night), // 3 nights from last week
  }, S, { today: mon });
  const r = st.week(mon, mon);
  assert.deepEqual(r.gym, { done: 1, planned: 1 });
  assert.equal(r.sleep.nights, 1); // last week's nights are left out
  assert.equal(st.sleepScore(mon).nights, 4); // the plain 7-night score is unchanged
  assert.doesNotMatch(weeklyText(r, EN), /focus on the gym/);
  assert.equal(createStats(data(), S).week(mon, '2026-10-25').gym.planned, 3); // whole week on Sunday
});

// ---- planner & coach -------------------------------------------------------------
test('an exam after school is a fixed block: nothing overlaps it', () => {
  for (const at of ['16:00', '13:30']) {
    const p = buildDayPlan({ date: '2026-10-19', settings: S, override: { exam: { subject: 'Bio', time: at } } });
    const exam = block(p, 'exam');
    for (const b of p.blocks.filter((x) => ['relax', 'gym', 'refuel', 'study'].includes(x.kind))) {
      assert.ok(b.endMin <= exam.startMin || b.startMin >= exam.endMin, `${at}: ${b.kind} ${b.start} overlaps the exam`);
    }
    assert.ok(block(p, 'study').endMin <= time.toMinutes('21:00'));
    const gymPush = messageSchedule(p, S).find((m) => m.key === 'gym');
    assert.ok(gymPush.atMin >= exam.endMin, `${at}: gym reminder during the exam`);
  }
  // A morning exam doesn't move the afternoon.
  const am = buildDayPlan({ date: '2026-10-19', settings: S, override: { exam: { subject: 'Bio', time: '10:00' } } });
  assert.equal(block(am, 'relax').start, '14:30');
  // An evening exam: everything still fits before it, so the gym stays.
  const pm = buildDayPlan({ date: '2026-10-19', settings: S, override: { exam: { subject: 'Bio', time: '19:00' } } });
  assert.ok(pm.gym && !pm.gymMoved, 'gym kept');
  assert.equal(pm.studyGoal, 60); // exam day: half the usual study
  assert.ok(block(pm, 'study').endMin <= time.toMinutes('19:00'));
});

test('weekend exams: study and catch-up gym move to after the exam, reminder never after the gym starts', () => {
  const sat = '2026-10-24';
  const p = buildDayPlan({ date: sat, settings: S, override: { exam: { subject: 'Bio', time: '10:30' } } });
  const exam = block(p, 'exam');
  assert.equal(block(p, 'study').start, '12:00');
  const catchUp = buildDayPlan({ date: sat, settings: S, override: { exam: { subject: 'Bio', time: '14:30' } }, gymWeek: { behind: 1, nextSplit: 'upper' } });
  const gym = block(catchUp, 'gym');
  assert.ok(gym.startMin >= block(catchUp, 'exam').endMin, `gym ${gym.start} overlaps the exam`);
  const push = messageSchedule(catchUp, S).find((m) => m.key === 'gym');
  assert.ok(push.atMin <= gym.startMin);
  assert.ok(exam);
  // Without an exam, weekend blocks stay exactly where you put them.
  const noExam = buildDayPlan({ date: sat, settings: mergeSettings({ schedule: { weekendGymAt: '11:30' } }), gymWeek: { behind: 1, nextSplit: 'upper' } });
  assert.equal(block(noExam, 'gym').start, '11:30');
});

test('lights out: after midnight wraps, an evening mix-up does not', () => {
  const at = (lightsOut, windDownAt = '22:00') => buildDayPlan({ date: '2026-10-19', settings: mergeSettings({ schedule: { lightsOut, windDownAt } }) });
  const late = at('00:30');
  assert.equal(block(late, 'winddown').endMin, 1440 + 30);
  assert.equal(late.blocks[late.blocks.length - 1].kind, 'sleep'); // sorted last
  const mixUp = at('21:30');
  assert.equal(block(mixUp, 'winddown').endMin, block(mixUp, 'winddown').startMin); // no 23.5 h wind-down
  assert.equal(block(mixUp, 'sleep').startMin, time.toMinutes('21:30'));
});

test('late check-in still gets its summary; 00:00 check-in doesn\'t squash the plan', () => {
  const late = mergeSettings({ onboarded: true, schedule: { checkinAt: '23:30', windDownAt: '23:40', lightsOut: '23:50' } });
  const sched = messageSchedule(buildDayPlan({ date: '2026-10-19', settings: late }), late);
  assert.equal(sched.find((m) => m.key === 'summary').atMin, time.toMinutes('23:59'));
  const midnight = mergeSettings({ onboarded: true, schedule: { checkinAt: '00:00' } });
  const p = buildDayPlan({ date: '2026-10-19', settings: midnight });
  assert.equal(p.gym, 'upper');
  assert.equal(block(p, 'study').end, '19:30');
});

test('"next chance" for the gym follows the real plans (planner changes, catch-up)', () => {
  const mon = '2026-10-19';
  const ctxFor = (day_plans) => ({ lang: 'en', settings: S, stats: createStats({ ...data(), day_plans }, S, { today: mon }), date: mon, templates: [] });
  const wedRest = ctxFor([{ date: '2026-10-21', day_type: 'rest' }]);
  assert.match(composeMessage('nudge_gym', wedRest).body, /Next chance: Friday/);
  assert.match(checkinReply({ trained: false }, wedRest), /Next session: Friday/);
  // Wednesday and Friday off → the Saturday catch-up session is the next chance.
  const both = ctxFor([{ date: '2026-10-21', day_type: 'rest' }, { date: '2026-10-23', skip_gym: true }]);
  assert.match(composeMessage('nudge_gym', both).body, /Next chance: Saturday/);
});

test('gym message shows the exact last weight (2 decimals)', () => {
  const templates = [{ id: 't1', key: 'upper', exercises: [{ id: 'bench', sets: 3, reps: '6-8' }] }];
  const prev = { id: 'w0', date: '2026-10-16', template_id: 't1', started_at: '2026-10-16T14:00:00Z' };
  const st = createStats({ ...data(), workouts: [prev], workout_sets: [{ id: 'a', workout_id: 'w0', exercise: 'bench', done: true, reps: 8, weight: 61.25 }] }, S);
  const ctx = { lang: 'en', settings: S, stats: st, date: '2026-10-19', templates };
  assert.match(composeMessage('gym', ctx).body, /61\.25 kg × 8/);
  assert.match(composeMessage('gym', { ...ctx, lang: 'de' }).body, /61,25 kg × 8/);
});

test('push text is shortened without cutting an emoji in half', () => {
  const body = 'a'.repeat(376) + '🔥 Current streak: 12'; // the emoji sits right on the old cut
  const out = shortenText(body, 380);
  assert.ok(out.isWellFormed(), 'no broken half-emoji');
  assert.ok(Array.from(out).length <= 380);
  assert.ok(out.endsWith('…'));
  assert.equal(shortenText('short 🔥', 380), 'short 🔥');
  // Prefers to stop at a line break.
  const lines = Array.from({ length: 12 }, (_, i) => `📚 line ${i} ${'x'.repeat(30)}`).join('\n');
  const kept = shortenText(lines, 380).slice(0, -1).split('\n');
  assert.ok(kept.length > 1 && kept.every((l) => lines.split('\n').includes(l)), 'only whole lines are kept');
});

// ---- Edge Functions (Deno) run in Node ---------------------------------------------
// The server functions are TypeScript for Deno. To test them here we strip the
// types (Node 22.13+), swap their imports for the objects given in `deps`, and
// keep the handler passed to Deno.serve. Nothing talks to a real database.
const canStrip = typeof nodeModule.stripTypeScriptTypes === 'function';
const serverTest = (name, fn) => test(name, { skip: !canStrip && 'needs Node 22.13+ (TypeScript type stripping)' }, fn);

function loadEdgeFunction(file, deps, names = []) {
  const warn = process.emitWarning;
  process.emitWarning = () => {}; // hide the "experimental feature" notice
  let src;
  try { src = nodeModule.stripTypeScriptTypes(readFileSync(new URL(file, import.meta.url), 'utf8')); } finally { process.emitWarning = warn; }
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'[^']*';/gm, (_, list) => `const {${list}} = __deps;`).replace(/^export\s+/gm, '');
  const out = {};
  const Deno = { serve: (handler) => { out.handler = handler; } };
  return Object.assign(out, new Function('__deps', 'Deno', `${src}\nreturn { ${names.join(', ')} };`)(deps, Deno));
}

/**
 * A tiny in-memory stand-in for the Supabase client: from().select().eq()…
 * Like the real API it returns at most `maxRows` rows per request.
 * Every query is recorded in db.queries ({ table, gte, lte, orders, range }).
 */
function fakeDb(tables, { maxRows = 1000 } = {}) {
  const queries = [];
  const db = {
    queries, tables,
    from(table) {
      const q = { table, filters: [], orders: [], range: null, op: 'select' };
      queries.push(q);
      const list = () => (tables[table] ||= []);
      const run = () => {
        const hit = list().filter((r) => q.filters.every((f) => f(r)));
        if (q.op === 'update') { for (const r of hit) Object.assign(r, q.patch); return { data: null, error: null }; }
        if (q.op !== 'select') return { data: null, error: null };
        const sorted = hit.slice().sort((a, b) => {
          for (const c of q.orders) { if (a[c] !== b[c]) return String(a[c]) < String(b[c]) ? -1 : 1; }
          return 0;
        });
        const [lo, hi] = q.range || [0, Infinity];
        const page = sorted.slice(lo, Math.min(hi + 1, lo + maxRows));
        return { data: q.single ? page[0] ?? null : page, error: null, count: hit.length };
      };
      const b = {
        select() { return b; },
        eq(c, v) { q.filters.push((r) => r[c] === v); return b; },
        gte(c, v) { q.gte = v; q.filters.push((r) => r[c] >= v); return b; },
        lte(c, v) { q.lte = v; q.filters.push((r) => r[c] <= v); return b; },
        in(c, vs) { q.filters.push((r) => vs.includes(r[c])); return b; },
        is(c, v) { q.filters.push((r) => (r[c] ?? null) === v); return b; },
        order(c) { q.orders.push(c); return b; },
        range(lo, hi) { q.range = [lo, hi]; return b; },
        limit(n) { q.range = [0, n - 1]; return b; },
        maybeSingle() { q.single = true; return b; },
        insert(row) { q.op = 'insert'; list().push(row); return b; },
        update(patch) { q.op = 'update'; q.patch = patch; return b; },
        upsert(row, opts = {}) {
          q.op = 'upsert';
          const keys = (opts.onConflict || 'id').split(',');
          const i = list().findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (i >= 0) list()[i] = { ...list()[i], ...row }; else list().push(row);
          return b;
        },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return b;
    },
  };
  return db;
}

const jsonStub = (body, status = 200) => ({ status, body });

function loadCoachTick(db, pushes = []) {
  return loadEdgeFunction('../supabase/functions/coach-tick/index.ts', {
    admin: () => db, json: jsonStub, getSecret: async () => 'secret', safeEqual: (a, b) => a === b,
    sendToUser: async (...args) => { pushes.push(args); return { sent: 1, failed: 0 }; },
    ...appTime, ...appDefaults, ...appStats, ...appCoach,
  }, ['rows', 'setsFor', 'tickUser', 'pushTtl']);
}

serverTest('coach-tick reads every row, past the 1000-rows-per-request cap', async () => {
  const foods = Array.from({ length: 2500 }, (_, i) => ({ id: `f${String(i).padStart(4, '0')}`, user_id: 'u1', date: time.addDays('2026-08-01', i % 80), deleted: false }));
  const sets = Array.from({ length: 1200 }, (_, i) => ({ id: `s${String(i).padStart(4, '0')}`, workout_id: `w${i % 3}`, deleted: false }));
  const db = fakeDb({ foods, workout_sets: sets });
  const ct = loadCoachTick(db);
  const got = await ct.rows(db, 'foods', 'u1', '2026-01-01');
  assert.equal(got.length, 2500);
  assert.equal(new Set(got.map((r) => r.id)).size, 2500);
  assert.deepEqual(db.queries[0].orders, ['date', 'id']); // a unique order, so pages don't overlap
  assert.equal((await ct.setsFor(db, ['w0', 'w1', 'w2'])).length, 1200);
});

serverTest('coach-tick weekly report: streak counts past 90 days; plans loaded a week ahead', async () => {
  const sunday = '2026-11-01';
  const own = (r) => ({ user_id: 'u1', deleted: false, ...r });
  const db = fakeDb({
    quests: [own(manual('m1'))],
    quest_log: time.dateRange(time.addDays(sunday, -150), time.addDays(sunday, -1)).map((date) => own({ quest_id: 'm1', date, xp: 10 })),
  });
  const ct = loadCoachTick(db);
  const res = await ct.tickUser(db, { user_id: 'u1', settings: { onboarded: true } }, new Date('2026-11-01T18:05:00Z'), true); // 19:05 Berlin
  const weekly = res.messages.find((m) => m.key === 'weekly');
  assert.match(weekly.body, /Current streak: 150/);
  assert.equal(db.queries.find((q) => q.table === 'foods').gte, time.addDays(sunday, -740));
  assert.equal(db.queries.filter((q) => q.table === 'day_plans').pop().lte, time.addDays(sunday, 8));
});

serverTest('coach-tick gives time-bound pushes a short lifetime', async () => {
  const pushes = [];
  const db = fakeDb({});
  const ct = loadCoachTick(db, pushes);
  assert.equal(ct.pushTtl('gym'), 30 * 60);
  assert.equal(ct.pushTtl('summary'), 12 * 3600);
  // Monday 15:05 Berlin: the 14:30 plan and the 15:00 gym reminder are due.
  await ct.tickUser(db, { user_id: 'u1', settings: { onboarded: true } }, new Date('2026-10-19T13:05:00Z'), false);
  const ttl = Object.fromEntries(pushes.map(([, , payload, opts]) => [payload.tag, opts.ttl]));
  assert.deepEqual(ttl, { plan: 12 * 3600, gym: 30 * 60 });
});

serverTest('sendToUser passes the lifetime on and shortens long texts safely', async () => {
  const sent = [];
  const { sendToUser } = loadEdgeFunction('../supabase/functions/_shared/notify.ts', {
    generateVapidKeys: async () => ({}), shortenText,
    sendPush: async (sub, message, vapid, opts) => { sent.push({ message, opts }); return { ok: true, status: 201 }; },
    getSecret: async (db, key) => (key === 'vapid' ? JSON.stringify({ publicKey: 'p', privateJwk: {} }) : null),
  }, ['sendToUser']);
  const db = fakeDb({ push_subscriptions: [{ id: 's1', user_id: 'u1', endpoint: 'https://push.example/1', p256dh: 'k', auth: 'a', failures: 0, deleted: false }] });
  await sendToUser(db, 'u1', { title: 'Gym', body: 'a'.repeat(376) + '🔥🔥🔥🔥🔥', tag: 'gym' }, { ttl: 1800 });
  await sendToUser(db, 'u1', { title: 'Coach', body: 'Test', tag: 'test' });
  assert.equal(sent[0].opts.ttl, 1800);
  assert.ok(sent[0].message.body.isWellFormed());
  assert.equal(sent[1].opts.ttl, 24 * 3600); // default
});

serverTest('steps endpoint: a missing or empty value is an error and never overwrites the day', async () => {
  const today = time.dateInTz('Europe/Berlin');
  const db = fakeDb({
    profiles: [{ user_id: 'u1', settings: { onboarded: true }, steps_token: 'tok', deleted: false }],
    steps: [{ user_id: 'u1', date: today, steps: 9000, source: 'shortcut', deleted: false }],
  });
  const fn = loadEdgeFunction('../supabase/functions/steps/index.ts', { admin: () => db, json: jsonStub, preflight: () => jsonStub('ok'), ...appTime, ...appDefaults }, ['parseSteps']);
  const call = (init, query = '') => fn.handler(new Request(`https://x.supabase.co/functions/v1/steps${query}`, init));
  const post = (body, type = 'application/json') => call({ method: 'POST', headers: { 'content-type': type, 'x-steps-token': 'tok' }, body });
  const stored = () => db.tables.steps[0].steps;

  for (const [label, res] of [
    ['empty string', await post(JSON.stringify({ steps: '' }))],
    ['no field', await post(JSON.stringify({}))],
    ['empty text body', await post('', 'text/plain')],
    ['GET without steps', await call({ method: 'GET' }, '?token=tok')],
  ]) {
    assert.equal(res.status, 400, label);
    assert.equal(stored(), 9000, label);
  }
  // A 0 for a day that has steps (Health unreadable) keeps the stored count…
  const zero = await post(JSON.stringify({ steps: 0, date: today }));
  assert.deepEqual([zero.status, zero.body.kept, stored()], [200, true, 9000]);
  const more = await post(JSON.stringify({ steps: '9.500', date: today }));
  assert.deepEqual([more.status, stored()], [200, 9500]);
  // …also when it was typed in by hand.
  db.tables.steps[0].source = 'manual';
  const zeroManual = await post(JSON.stringify({ steps: 0, date: today }));
  assert.deepEqual([zeroManual.body.kept, stored()], [true, 9500]);
  // A lower real reading replaces it (e.g. a double-counting Shortcut was fixed).
  const lower = await post(JSON.stringify({ steps: 8000, date: today }));
  assert.deepEqual([lower.status, lower.body.kept, stored()], [200, undefined, 8000]);

  assert.equal(fn.parseSteps('8,123'), 8123);
  assert.equal(fn.parseSteps(8123.4), 8123);
  for (const v of [undefined, null, '', '   ', [], 'abc']) assert.ok(Number.isNaN(fn.parseSteps(v)), String(v));
});

test('Edge Functions deploy without the gateway JWT check (they check callers themselves)', () => {
  const toml = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(toml, /^project_id\s*=/m);
  for (const fn of ['account', 'push', 'steps', 'coach-tick']) {
    assert.match(toml, new RegExp(`\\[functions\\.${fn}\\]\\s*\\nverify_jwt\\s*=\\s*false`), fn);
  }
});
