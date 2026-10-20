// Unit tests for the shared logic (planner, time zones, stats, coach).
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as time from '../web/js/shared/time.js';
import { DEFAULT_SETTINGS, mergeSettings, suggestTargets } from '../web/js/shared/defaults.js';
import { buildDayPlan, gymWeekInfo } from '../web/js/shared/plan.js';
import { createStats, levelFromXp } from '../web/js/shared/stats.js';
import { messageSchedule, dueMessages, composeMessage, summaryText, weeklyText, checkinReply, fill } from '../web/js/shared/coach.js';
import { TEXT } from '../web/js/shared/coach-text.js';

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
