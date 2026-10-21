// =============================================================================
// Stats engine — everything that is *calculated* from your logged data:
// day totals, quest status, XP & levels, streaks, weekly reports, sleep score.
// -----------------------------------------------------------------------------
// createStats(data, settings) takes plain arrays of rows (no deleted rows) and
// returns helper functions. The app builds it from its local cache; the
// server builds it from a database query — so both always agree.
// Optional third argument: { today: 'YYYY-MM-DD' } (default: today in your
// time zone). Days before `today` are history — see questsFor.
// Shared with the server — keep it free of browser APIs.
// =============================================================================

import { buildDayPlan, gymWeekInfo } from './plan.js';
import { addDays, weekStart, weekdayOf, dateRange, zonedParts, toMinutes, toHHMM, dateInTz } from './time.js';

/** A day counts toward your streak when at least 75% of its quests are done. */
export const STREAK_THRESHOLD = 0.75;

/**
 * Levels: level L starts at 50·L·(L−1) XP → L2 at 100, L3 at 300, L4 at 600,
 * L5 at 1000, L10 at 4500. A full day is roughly 100–130 XP.
 */
export function levelFromXp(xp) {
  const total = Math.max(0, Math.floor(xp || 0));
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * total) / 50)) / 2));
  const start = 50 * level * (level - 1);
  const next = 50 * (level + 1) * level;
  return { level, xp: total, into: total - start, span: next - start, progress: (total - start) / (next - start) };
}

const EMPTY_TABLES = [
  'foods', 'steps', 'study_sessions', 'workouts', 'workout_sets', 'checkins', 'sleep_logs',
  'quests', 'quest_log', 'day_plans', 'weights', 'events', 'workout_templates',
];

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}
const mapBy = (rows, key) => new Map(rows.map((r) => [r[key], r]));
const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const round1 = (n) => Math.round(n * 10) / 10;

/** Standard deviation (population). */
function sd(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}

export function createStats(rawData, settings, opts = {}) {
  const data = {};
  for (const t of EMPTY_TABLES) data[t] = (rawData[t] || []).filter((r) => !r.deleted);
  const tz = settings.timezone;
  const targets = settings.targets;
  // Today's date, fixed when the stats are built (the app rebuilds them after
  // every change). Days before it are history — see questsFor.
  const asOf = opts.today || dateInTz(tz);

  const foodsBy = groupBy(data.foods, 'date');
  const stepsBy = mapBy(data.steps, 'date');
  const studyBy = groupBy(data.study_sessions, 'date');
  const setsByWorkout = groupBy(data.workout_sets, 'workout_id');
  // A workout only counts once at least one set is ticked off.
  const countedWorkouts = data.workouts.filter((w) => (setsByWorkout.get(w.id) || []).some((s) => s.done));
  const workoutsBy = groupBy(countedWorkouts, 'date');
  const checkinBy = mapBy(data.checkins, 'date');
  const sleepBy = mapBy(data.sleep_logs, 'date');
  const overrideBy = mapBy(data.day_plans, 'date');
  const questLog = new Map(data.quest_log.map((r) => [`${r.quest_id}|${r.date}`, r]));
  // All quests, including switched-off ones: a quest you switch off today
  // still counted on the days before (see questLiveOn).
  const quests = data.quests.slice().sort((a, b) => a.sort - b.sort);
  // 'YYYY-MM-DD' of a date or timestamp column (null when empty).
  const dayOf = (v) => (!v ? null : String(v).length > 10 ? dateInTz(tz, new Date(v)) : String(v));
  const createdOn = new Map(quests.map((q) => [q.id, dayOf(q.created_at)]));
  const offSince = new Map(quests.map((q) => [q.id, dayOf(q.inactive_since)]));

  /**
   * Did this quest exist, and was it switched on, on `date`?
   *   created_at     – a quest doesn't count on days before you added it
   *   inactive_since – a switched-off quest still counts on the days before
   *                    you switched it off (but not from that day on)
   * Both columns are optional: without them a quest counts on every day
   * while it's switched on.
   */
  function questLiveOn(q, date) {
    const created = createdOn.get(q.id);
    if (created && date < created) return false;
    if (q.active) return true;
    const off = offSince.get(q.id);
    return !!off && date < off;
  }

  const planCache = new Map();
  /** The plan for a date (cached). */
  function planFor(date) {
    if (!planCache.has(date)) {
      planCache.set(date, buildDayPlan({
        date, settings,
        override: overrideBy.get(date),
        nextOverride: overrideBy.get(addDays(date, 1)),
        gymWeek: gymWeekInfo(date, settings, countedWorkouts),
      }));
    }
    return planCache.get(date);
  }

  const dayCache = new Map();
  /** Totals for one day. steps is null when nothing was logged. */
  function day(date) {
    if (dayCache.has(date)) return dayCache.get(date);
    const foods = (foodsBy.get(date) || []).slice().sort((a, b) => String(a.eaten_at).localeCompare(String(b.eaten_at)));
    const study = studyBy.get(date) || [];
    const stepsRow = stepsBy.get(date);
    const d = {
      date,
      foods,
      kcal: Math.round(sum(foods, (f) => f.kcal)),
      protein: round1(sum(foods, (f) => f.protein)),
      steps: stepsRow ? stepsRow.steps : null,
      stepsSource: stepsRow?.source || null,
      study,
      studyMin: Math.round(sum(study, (s) => s.minutes)),
      workouts: workoutsBy.get(date) || [],
      checkin: checkinBy.get(date) || null,
      sleep: sleepBy.get(date) || null,
    };
    dayCache.set(date, d);
    return d;
  }

  /**
   * Status of every quest that was switched on on a date.
   * Auto quests (study/steps/workout/protein) follow your data and plan;
   * manual ones follow what you ticked.
   *
   * Past days are history: a quest with an XP entry (quest_log) on a day
   * before today stays applicable and done on that day — it was earned under
   * the targets and schedule you had back then. So raising a target, changing
   * a quest's days or your gym days later doesn't take back XP or break your
   * streak. Today always follows the live data (delete a meal → XP goes back).
   */
  function questsFor(date) {
    const plan = planFor(date);
    const d = day(date);
    const wd = weekdayOf(date);
    const past = date < asOf;
    return quests.filter((q) => questLiveOn(q, date)).map((q) => {
      const onDay = (q.days || []).map(Number).includes(wd);
      let applicable = onDay, value = 0, target = 1, done = false;
      switch (q.kind) {
        case 'study':
          target = plan.studyGoal; value = d.studyMin;
          applicable = onDay && target > 0; done = value >= target;
          break;
        case 'steps':
          target = targets.steps; value = d.steps || 0; done = value >= target;
          break;
        case 'workout':
          // Follows your gym schedule (incl. catch-up days), not the quest's days.
          target = 1; value = d.workouts.length;
          applicable = !!plan.gym || value > 0; done = value > 0;
          break;
        case 'protein':
          target = targets.protein; value = d.protein; done = value >= target;
          break;
        default: {
          const log = questLog.get(`${q.id}|${date}`);
          value = log ? 1 : 0; done = !!log;
        }
      }
      if (past && questLog.has(`${q.id}|${date}`)) { applicable = true; done = true; }
      return { quest: q, applicable, done: applicable && done, value, target, progress: target > 0 ? Math.min(1, value / target) : 0 };
    });
  }

  /** How much of a day's quests were done. */
  function completion(date) {
    const qs = questsFor(date).filter((q) => q.applicable);
    const done = qs.filter((q) => q.done).length;
    return { applicable: qs.length, done, ratio: qs.length ? done / qs.length : 0 };
  }

  /**
   * Current streak in days. Today counts once it qualifies, but an unfinished
   * today never breaks the streak (the day isn't over yet).
   */
  function streak(today) {
    let count = 0;
    const t = completion(today);
    if (t.applicable && t.ratio >= STREAK_THRESHOLD) count++;
    let d = addDays(today, -1);
    for (let i = 0; i < 730; i++, d = addDays(d, -1)) {
      const c = completion(d);
      if (!c.applicable) continue; // no quests that day — neutral
      if (c.ratio >= STREAK_THRESHOLD) count++;
      else break;
    }
    return count;
  }

  /** Best-ever streak (scans your history once). */
  function bestStreak(today) {
    const first = data.quest_log.reduce((m, r) => (r.date < m ? r.date : m), today);
    let best = 0, run = 0;
    for (const d of dateRange(first, today)) {
      const c = completion(d);
      if (!c.applicable) continue;
      if (c.ratio >= STREAK_THRESHOLD) best = Math.max(best, ++run);
      else if (d !== today) run = 0;
    }
    return best;
  }

  const xpTotal = sum(data.quest_log, (r) => r.xp);

  /**
   * Sleep consistency over the 7 nights ending on `endDate` (wake-up dates).
   * With `startDate`, nights before it are left out (a week in progress
   * shouldn't mix in last week's nights).
   * Score (0–100) = 70% consistency + 30% on-time.
   *   consistency: 100 when you go to bed and wake at the same times every
   *                day; −50 for every hour of variation (standard deviation).
   *   on-time:     share of nights in bed by lights-out + 15 min.
   * Needs at least 3 logged nights.
   */
  function sleepScore(endDate, startDate) {
    const from = startDate && startDate > addDays(endDate, -6) ? startDate : addDays(endDate, -6);
    const logs = dateRange(from, endDate).map((d) => sleepBy.get(d)).filter(Boolean);
    if (logs.length < 3) return { score: null, nights: logs.length };
    // Bedtimes as minutes after noon, so 23:30 and 00:30 are 60 min apart, not 23 h.
    const bed = logs.map((l) => { const p = zonedParts(new Date(l.slept_at), tz); return (p.hour * 60 + p.minute + 720) % 1440; });
    const wake = logs.map((l) => { const p = zonedParts(new Date(l.woke_at), tz); return p.hour * 60 + p.minute; });
    const dur = logs.map((l) => (Date.parse(l.woke_at) - Date.parse(l.slept_at)) / 60000);
    const avgSd = (sd(bed) + sd(wake)) / 2;
    const consistency = Math.max(0, Math.min(100, 100 - (avgSd * 50) / 60));
    const target = (toMinutes(settings.schedule.lightsOut) + 720) % 1440;
    const onTimeNights = bed.filter((b) => b <= target + 15).length;
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return {
      score: Math.round(0.7 * consistency + 0.3 * (onTimeNights / logs.length) * 100),
      nights: logs.length,
      consistency: Math.round(consistency),
      onTimeNights,
      avgDurationMin: Math.round(mean(dur)),
      avgBed: toHHMM(mean(bed) - 720),
      avgWake: toHHMM(mean(wake)),
      variationMin: Math.round(avgSd),
    };
  }

  /** Daily summary numbers (used by the coach's evening summary). */
  function summary(date) {
    const plan = planFor(date);
    const d = day(date);
    const c = completion(date);
    return {
      date, plan,
      studyMin: d.studyMin, studyGoal: plan.studyGoal,
      gymPlanned: !!plan.gym, gymDone: d.workouts.length > 0,
      kcal: d.kcal, protein: d.protein, foodsLogged: d.foods.length,
      kcalTarget: targets.kcal, proteinTarget: targets.protein,
      steps: d.steps, stepsGoal: targets.steps,
      quests: c,
    };
  }

  /** Weekly report for the Mon–Sun week starting `ws`, counting days up to `today`. */
  function week(ws, today) {
    const end = addDays(ws, 6);
    const last = today < end ? today : end;
    const days = last >= ws ? dateRange(ws, last) : [];
    const per = days.map((dt) => ({ date: dt, plan: planFor(dt), d: day(dt) }));

    const studyGoal = sum(per, (x) => x.plan.studyGoal);
    const studyMin = sum(per, (x) => x.d.studyMin);
    const studyDaysPlanned = per.filter((x) => x.plan.studyGoal > 0).length;
    const studyDaysHit = per.filter((x) => x.plan.studyGoal > 0 && x.d.studyMin >= x.plan.studyGoal).length;

    // Scheduled sessions on the days counted so far (the whole week on Sunday),
    // so a Monday report isn't judged against Wednesday's and Friday's sessions.
    const gymPlanned = per.filter((x) => (settings.schedule.gymDays || {})[x.plan.weekday]).length;
    const gymDone = countedWorkouts.filter((w) => w.date >= ws && w.date <= end).length;

    const foodDays = per.filter((x) => x.d.foods.length > 0);
    const avgKcal = foodDays.length ? Math.round(sum(foodDays, (x) => x.d.kcal) / foodDays.length) : null;
    const avgProtein = foodDays.length ? Math.round(sum(foodDays, (x) => x.d.protein) / foodDays.length) : null;
    const proteinDaysHit = foodDays.filter((x) => x.d.protein >= targets.protein).length;
    const kcalDaysOnTarget = foodDays.filter((x) => Math.abs(x.d.kcal - targets.kcal) <= targets.kcal * 0.1).length;

    const stepDays = per.filter((x) => x.d.steps != null);
    const avgSteps = stepDays.length ? Math.round(sum(stepDays, (x) => x.d.steps) / stepDays.length) : null;
    const stepsDaysHit = stepDays.filter((x) => x.d.steps >= targets.steps).length;

    const checkins = per.filter((x) => x.d.checkin).length;
    const questDays = per.map((x) => completion(x.date)).filter((c) => c.applicable);
    const perfectDays = questDays.filter((c) => c.ratio >= STREAK_THRESHOLD).length;

    // Weight change over the week (first vs last weigh-in), if any.
    const weights = data.weights.filter((w) => w.date >= ws && w.date <= end).sort((a, b) => a.date.localeCompare(b.date));
    const weightChange = weights.length >= 2 ? round1(weights[weights.length - 1].kg - weights[0].kg) : null;

    return {
      start: ws, end, daysCounted: days.length,
      study: { minutes: studyMin, goal: studyGoal, daysPlanned: studyDaysPlanned, daysHit: studyDaysHit },
      gym: { done: gymDone, planned: gymPlanned },
      food: { loggedDays: foodDays.length, avgKcal, avgProtein, kcalTarget: targets.kcal, proteinTarget: targets.protein, proteinDaysHit, kcalDaysOnTarget },
      steps: { avg: avgSteps, goal: targets.steps, loggedDays: stepDays.length, daysHit: stepsDaysHit },
      sleep: sleepScore(last, ws),
      checkins,
      quests: { days: questDays.length, goodDays: perfectDays },
      streak: streak(today),
      weight: { change: weightChange, latest: weights.length ? Number(weights[weights.length - 1].kg) : null },
    };
  }

  return {
    data, planFor, day, questsFor, completion, streak, bestStreak, sleepScore, summary, week,
    xp: xpTotal, level: levelFromXp(xpTotal),
    countedWorkouts, setsByWorkout,
  };
}

/** Start of the week (Monday) for `date` — re-exported for convenience. */
export { weekStart };
