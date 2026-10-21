// =============================================================================
// The coach: which messages go out when, and what they say.
// -----------------------------------------------------------------------------
// Used by the server (coach-tick Edge Function, every minute) to send push
// notifications, and by the app for check-in replies and report previews.
// Message wording lives in coach-text.js (all languages).
// Shared with the server — keep it free of browser APIs.
// =============================================================================

import { toMinutes, toHHMM, isHHMM, addDays, weekdayOf, weekStart } from './time.js';
import { splitName, blockName, exerciseName, findTemplate } from './names.js';
import { TEXT } from './coach-text.js';

/** A message is still sent if the scheduler runs up to this many minutes late. */
export const WINDOW_MIN = 90;

const LOCALES = { en: 'en-GB', es: 'es-ES', de: 'de-DE', ru: 'ru-RU', zh: 'zh-CN', ar: 'ar-u-nu-latn' };

/** Fill "{name}" placeholders. Numbers are formatted for the language. */
export function fill(str, vars = {}, lang = 'en') {
  const nf = new Intl.NumberFormat(LOCALES[lang] || 'en-GB', { maximumFractionDigits: 1 });
  return String(str).replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars[k];
    if (v === undefined || v === null) return m;
    return typeof v === 'number' ? nf.format(v) : String(v);
  });
}

function textFor(lang) {
  const base = TEXT.en;
  const T = TEXT[lang];
  if (!T || lang === 'en') return base;
  // Deep fallback to English for anything not translated.
  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] || {}, v) : v;
    return out;
  };
  return merge(base, T);
}

export function weekdayName(dateStr, lang) {
  return new Intl.DateTimeFormat(LOCALES[lang] || 'en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(dateStr + 'T12:00:00Z'));
}

export function durationText(min, lang) {
  const T = textFor(lang);
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60), r = m % 60;
  if (h && r) return fill(T.units.hm, { h, m: r }, lang);
  if (h) return fill(T.units.h, { h }, lang);
  return fill(T.units.min, { n: r }, lang);
}

/**
 * The day's message schedule: [{ key, pref, atMin }].
 * `pref` is the notification setting that controls the push for it.
 */
export function messageSchedule(plan, settings) {
  const s = settings.schedule;
  const out = [];
  const add = (key, pref, min) => { if (Number.isFinite(min) && min >= 0 && min < 1440) out.push({ key, pref, atMin: min }); };
  const block = (kind) => plan.blocks.find((b) => b.kind === kind);
  const checkin = toMinutes(s.checkinAt);

  if (plan.exam) add('morning_exam', 'morning', Math.min(toMinutes('07:00'), plan.exam.time ? toMinutes(plan.exam.time) - 60 : 1440));
  if (plan.type === 'short' || plan.type === 'long') add('plan', 'plan', toMinutes(plan.freeFrom));
  else add('plan', 'plan', toMinutes('10:00'));

  const gym = block('gym');
  if (gym) {
    // 30 min before — but not during an exam that ends shortly before the gym.
    const exam = block('exam');
    const at = exam && exam.startMin < gym.startMin ? Math.max(gym.startMin - 30, exam.endMin) : gym.startMin - 30;
    // If the reminder would land during school, the plan message covers it.
    if (!plan.freeFrom || at >= toMinutes(plan.freeFrom)) add('gym', 'gym', at);
    if (Number.isFinite(checkin) && gym.endMin <= checkin - 60) add('nudge_gym', 'nudges', checkin - 60);
  }
  const study = block('study');
  if (study) {
    add('study_start', 'study', study.startMin);
    add('study_end', 'study', study.endMin);
    if (Number.isFinite(checkin) && study.endMin <= checkin - 45) add('nudge_study', 'nudges', checkin - 45);
  }
  if (Number.isFinite(checkin)) {
    add('checkin', 'checkin', checkin);
    // A late check-in (23:30 or later) still gets its summary, at 23:59.
    add('summary', 'summary', Math.min(checkin + 30, 1439));
  }
  if (isHHMM(s.windDownAt)) add('winddown', 'winddown', toMinutes(s.windDownAt));
  if (plan.weekday === 0) add('weekly', 'weekly', toMinutes('19:00'));
  return out.sort((a, b) => a.atMin - b.atMin);
}

/** Messages that should be sent right now and haven't been yet. */
export function dueMessages(plan, settings, nowMin, sentKeys) {
  return messageSchedule(plan, settings).filter((m) => nowMin >= m.atMin && nowMin < m.atMin + WINDOW_MIN && !sentKeys.has(m.key));
}

/**
 * Write a message. Returns { title, body, data } or null when it shouldn't be
 * sent after all (e.g. study reminder when you already hit your goal).
 *   ctx = { lang, settings, stats, date, templates }
 */
export function composeMessage(key, ctx) {
  const { lang, settings, stats, date } = ctx;
  const T = textFor(lang);
  const plan = stats.planFor(date);
  const day = stats.day(date);
  const s = settings.schedule;
  const f = (str, vars) => fill(str, vars, lang);
  const title = T.title[key] || T.title.coach;
  const split = (ref) => splitName(ref, ctx.templates, lang);

  switch (key) {
    case 'plan':
      return { title, body: planText(plan, ctx), data: { type: 'plan' } };

    case 'morning_exam': {
      const e = plan.exam;
      const tpl = e.subject && e.time ? T.morningExam.full : e.subject ? T.morningExam.subject : e.time ? T.morningExam.time : T.morningExam.plain;
      return { title, body: f(tpl, { subject: e.subject, time: e.time }), data: { type: 'exam' } };
    }

    case 'gym': {
      if (day.workouts.length) return null; // already trained
      const lines = [f(T.gym.pre, { split: split(plan.gym) })];
      const best = lastTopSet(plan.gym, ctx);
      if (best) {
        // Weights are stored with up to 2 decimals (61.25 kg): show them exactly,
        // not rounded to 1 decimal like other numbers (a string is left as is by fill).
        const weight = new Intl.NumberFormat(LOCALES[lang] || 'en-GB', { maximumFractionDigits: 2 }).format(best.weight);
        lines.push(f(T.gym.last, { exercise: exerciseName(best.exercise, lang), weight, reps: best.reps }));
      } else lines.push(f(T.gym.first, { split: split(plan.gym) }));
      if (plan.gymCatchUp) lines.push(T.gym.catchUp);
      if (plan.examTomorrow) lines.push(T.gym.moderate);
      return { title, body: lines.join('\n'), data: { type: 'gym', split: plan.gym } };
    }

    case 'study_start': {
      if (plan.studyGoal <= 0 || day.studyMin >= plan.studyGoal) return null;
      const minutes = durationText(plan.studyGoal - day.studyMin, lang);
      const tpl = plan.studyFocus ? T.study.focus : plan.type === 'long' ? T.study.long : T.study.start;
      return { title, body: f(tpl, { minutes, subject: plan.studyFocus }), data: { type: 'study' } };
    }

    case 'study_end': {
      if (plan.studyGoal <= 0) return null;
      const hit = day.studyMin >= plan.studyGoal;
      return { title, body: hit ? f(T.study.endHit, { done: durationText(day.studyMin, lang) }) : T.study.endLog, data: { type: 'study_end', openTimer: !hit } };
    }

    case 'nudge_gym': {
      if (!plan.gym || day.workouts.length) return null;
      if (plan.gymCatchUp) return { title, body: T.nudge.gymCatchUp, data: { type: 'nudge' } };
      const next = nextGymDay(date, stats);
      return { title, body: f(T.nudge.gym, { day: next ? weekdayName(next, lang) : '–' }), data: { type: 'nudge' } };
    }

    case 'nudge_study': {
      if (plan.studyGoal <= 0 || day.studyMin >= plan.studyGoal * 0.5) return null;
      const vars = { done: durationText(day.studyMin, lang), goal: durationText(plan.studyGoal, lang), time: s.checkinAt };
      return { title, body: f(day.studyMin > 0 ? T.nudge.studySome : T.nudge.studyNone, vars), data: { type: 'nudge' } };
    }

    case 'checkin': {
      const c = day.checkin;
      if (c && c.studied !== null && c.studied !== undefined && c.trained !== null && c.trained !== undefined) return null;
      return { title, body: `${T.checkin.ask}\n${T.checkin.tomorrow}`, data: { type: 'checkin' } };
    }

    case 'summary':
      return { title, body: summaryText(stats.summary(date), ctx), data: { type: 'summary' } };

    case 'winddown': {
      const tomorrow = stats.planFor(addDays(date, 1));
      const tpl = tomorrow.exam ? T.winddown.exam : T.winddown.base;
      return { title, body: f(tpl, { time: s.windDownAt, lightsOut: s.lightsOut }), data: { type: 'winddown' } };
    }

    case 'weekly': {
      const report = stats.week(weekStart(date), date);
      return { title, body: weeklyText(report, ctx), data: { type: 'weekly', week: report.start } };
    }
    default:
      return null;
  }
}

/**
 * Next date after `date` (within a week) that has gym in its plan. Uses the
 * real plans, so planner changes (rest day, skip gym) and weekend catch-up
 * sessions count — not just the weekly gym days from the settings.
 */
function nextGymDay(date, stats) {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(date, i);
    if (stats.planFor(d).gym) return d;
  }
  return null;
}

/** Heaviest set of the first exercise from the last session of this split. */
function lastTopSet(splitRef, ctx) {
  const tpl = findTemplate(splitRef, ctx.templates);
  if (!tpl) return null;
  const firstEx = (tpl.exercises || [])[0];
  if (!firstEx) return null;
  const sessions = ctx.stats.countedWorkouts.filter((w) => w.template_id === tpl.id && w.date < ctx.date)
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.started_at).localeCompare(String(a.started_at)));
  for (const w of sessions) {
    const sets = (ctx.stats.setsByWorkout.get(w.id) || []).filter((x) => x.done && x.exercise === firstEx.id && x.weight > 0 && x.reps > 0);
    if (sets.length) {
      const top = sets.reduce((a, b) => (Number(b.weight) > Number(a.weight) || (Number(b.weight) === Number(a.weight) && b.reps > a.reps) ? b : a));
      return { exercise: firstEx, weight: Number(top.weight), reps: top.reps };
    }
  }
  return null;
}

/** "School's out. Here's the plan: …" */
export function planText(plan, ctx) {
  const { lang, settings } = ctx;
  const T = textFor(lang);
  const f = (str, vars) => fill(str, vars, lang);
  if (plan.type === 'rest') {
    return [T.plan.rest, plan.note && f(T.plan.note, { note: plan.note })].filter(Boolean).join('\n');
  }
  const lines = [T.plan[plan.type] || T.plan.weekend];
  // Only what's still ahead when the message goes out (after school ends).
  const from = plan.freeFrom ? toMinutes(plan.freeFrom) : 0;
  const shown = plan.blocks.filter((b) => ['relax', 'gym', 'refuel', 'study', 'exam'].includes(b.kind) && b.startMin >= from);
  for (const b of shown) {
    let label = blockName(b, plan.type, lang);
    if (b.kind === 'gym') label += ` · ${splitName(b.split, ctx.templates, lang)}`;
    if (b.kind === 'study') label += ` · ${durationText(b.minutes, lang)}`;
    if (b.kind === 'exam' && b.subject) label += ` · ${b.subject}`;
    lines.push(`${b.start}  ${label}`);
  }
  if (plan.type === 'weekend' && shown.length) lines.push(T.plan.weekendFree);
  if (plan.type === 'weekend' && !shown.length) lines.push(T.plan.weekendEmpty);
  const extras = [];
  if (plan.examTomorrow) extras.push(plan.examTomorrow.subject ? f(T.plan.examTomorrow, { subject: plan.examTomorrow.subject }) : T.plan.examTomorrowPlain);
  if (plan.exam) extras.push(T.plan.examToday);
  if (plan.gymCatchUp) {
    const gymDays = Object.values(settings.schedule.gymDays || {}).filter(Boolean).length;
    const done = ctx.stats.countedWorkouts.filter((w) => w.date >= weekStart(plan.date) && w.date < plan.date).length;
    extras.push(f(T.plan.catchUp, { done, target: gymDays }));
  }
  if (plan.gymMoved) {
    const next = nextGymDay(plan.date, ctx.stats);
    extras.push(f(T.plan.gymMoved, { day: next ? weekdayName(next, lang) : '–' }));
  }
  if (plan.trimmed && !plan.gymMoved) extras.push(f(T.plan.trimmed, { time: settings.schedule.checkinAt }));
  if (plan.note) extras.push(f(T.plan.note, { note: plan.note }));
  lines.push('', ...extras, f(T.plan.footer, { checkin: settings.schedule.checkinAt, lightsOut: settings.schedule.lightsOut }));
  return lines.filter((l, i, a) => !(l === '' && (i === a.length - 1 || a[i + 1] === ''))).join('\n').trim();
}

/** Evening summary — honest: misses are named, not hidden. */
export function summaryText(sm, ctx) {
  const { lang } = ctx;
  const T = textFor(lang);
  const f = (str, vars) => fill(str, vars, lang);
  const lines = [T.summary.head];
  const results = []; // [name, ratio] for the verdict

  if (sm.studyGoal > 0) {
    const r = sm.studyMin / sm.studyGoal;
    const icon = r >= 1 ? '✅' : sm.studyMin > 0 ? '⚠️' : '❌';
    lines.push(`${icon} ${f(T.summary.study, { done: durationText(sm.studyMin, lang), goal: durationText(sm.studyGoal, lang) })}`);
    results.push(['study', Math.min(1, r)]);
  } else if (sm.studyMin > 0) {
    lines.push(`✅ ${f(T.summary.studyBonus, { done: durationText(sm.studyMin, lang) })}`);
  }
  if (sm.gymPlanned) {
    lines.push(sm.gymDone ? `✅ ${T.summary.gymDone}` : `❌ ${T.summary.gymMissed}`);
    results.push(['gym', sm.gymDone ? 1 : 0]);
  } else if (sm.gymDone) lines.push(`✅ ${T.summary.gymBonus}`);

  if (sm.foodsLogged) {
    const pr = sm.protein / sm.proteinTarget;
    const icon = pr >= 1 ? '✅' : pr >= 0.8 ? '⚠️' : '❌';
    lines.push(`${icon} ${f(T.summary.food, { kcal: sm.kcal, kcalT: sm.kcalTarget, p: Math.round(sm.protein), pT: sm.proteinTarget })}`);
    if (sm.kcal > sm.kcalTarget * 1.1) lines.push(`   ${f(T.summary.overKcal, { n: sm.kcal - sm.kcalTarget })}`);
    results.push(['protein', Math.min(1, pr)]);
  } else {
    // Not logging food is a miss too — otherwise a day with no food logged
    // could still be called "Every goal hit".
    lines.push(`➖ ${T.summary.noFood}`);
    results.push(['logging', 0]);
  }
  if (sm.steps != null) {
    const r = sm.steps / sm.stepsGoal;
    lines.push(`${r >= 1 ? '✅' : '⚠️'} ${f(T.summary.steps, { n: sm.steps, goal: sm.stepsGoal })}`);
    results.push(['steps', Math.min(1, r)]);
  } else {
    lines.push(`➖ ${T.summary.noSteps}`);
  }

  const hits = results.filter(([, r]) => r >= 1).length;
  const missed = results.find(([, r]) => r < 1);
  let verdict;
  // Nothing to judge but the missing food log (e.g. a rest day) → ask for data.
  if (results.every(([k]) => k === 'logging')) verdict = T.summary.verdictNoData;
  else if (hits === results.length) verdict = T.summary.verdictAll;
  else if (hits / results.length >= 0.6) verdict = f(T.summary.verdictGood, { thing: T.things[missed[0]] });
  else if (hits > 0) verdict = f(T.summary.verdictMixed, { thing: T.things[missed[0]] });
  else verdict = T.summary.verdictOff;
  lines.push('', verdict);
  return lines.join('\n');
}

/** Sunday weekly report. */
export function weeklyText(r, ctx) {
  const { lang } = ctx;
  const T = textFor(lang);
  const f = (str, vars) => fill(str, vars, lang);
  const lines = [T.weekly.head];
  const ratios = [];

  lines.push(`📚 ${f(T.weekly.study, { done: durationText(r.study.minutes, lang), goal: durationText(r.study.goal, lang), hit: r.study.daysHit, days: r.study.daysPlanned })}`);
  if (r.study.goal > 0) ratios.push(['study', r.study.minutes / r.study.goal]);
  lines.push(`🏋️ ${f(T.weekly.gym, { done: r.gym.done, planned: r.gym.planned })}`);
  if (r.gym.planned > 0) ratios.push(['gym', r.gym.done / r.gym.planned]);

  if (r.food.loggedDays) {
    lines.push(`🍽 ${f(T.weekly.food, { kcal: r.food.avgKcal, kcalT: r.food.kcalTarget, p: r.food.avgProtein, pT: r.food.proteinTarget, days: r.food.loggedDays, total: r.daysCounted })}`);
    ratios.push(['protein', r.food.avgProtein / r.food.proteinTarget]);
    if (r.food.loggedDays < Math.min(4, r.daysCounted)) {
      lines.push(`   ${f(T.weekly.fewFoodDays, { days: r.food.loggedDays })}`);
      ratios.push(['logging', r.food.loggedDays / r.daysCounted]);
    }
  } else {
    lines.push(`🍽 ${T.weekly.noFood}`);
    ratios.push(['logging', 0]);
  }
  if (r.steps.loggedDays) {
    lines.push(`👟 ${f(T.weekly.steps, { avg: r.steps.avg, goal: r.steps.goal, hit: r.steps.daysHit, days: r.daysCounted })}`);
    // The average only covers days that synced. With too few of them it says
    // little, so flag it and keep steps out of the verdict (one good day
    // shouldn't make steps "your best area").
    if (r.steps.loggedDays >= Math.min(4, r.daysCounted)) ratios.push(['steps', r.steps.avg / r.steps.goal]);
    else lines.push(`   ${f(T.weekly.fewStepDays, { days: r.steps.loggedDays, total: r.daysCounted })}`);
  } else lines.push(`👟 ${T.weekly.noSteps}`);

  if (r.sleep.score != null) {
    lines.push(`😴 ${f(T.weekly.sleep, { score: r.sleep.score, bed: r.sleep.avgBed, dur: durationText(r.sleep.avgDurationMin, lang) })}`);
    ratios.push(['sleep', r.sleep.score / 100]);
  } else lines.push(`😴 ${f(T.weekly.noSleep, { n: r.sleep.nights })}`);

  if (r.weight.change != null) lines.push(`⚖️ ${f(r.weight.change <= 0 ? T.weekly.weightDown : T.weekly.weightUp, { n: Math.abs(r.weight.change), kg: r.weight.latest })}`);
  lines.push(`🔥 ${f(T.weekly.streak, { n: r.streak })}`);

  const sorted = ratios.slice().sort((a, b) => a[1] - b[1]);
  const gap = sorted[0];
  const win = sorted[sorted.length - 1];
  let verdict;
  if (!ratios.length) verdict = T.weekly.verdictEmpty;
  else if (gap[1] >= 0.9) verdict = T.weekly.verdictStrong;
  else if (gap[1] < 0.5) verdict = f(T.weekly.verdictGap, { thing: T.things[gap[0]], tip: T.tips[gap[0]] });
  else verdict = f(T.weekly.verdictGood, { win: T.things[win[0]], thing: T.things[gap[0]], tip: T.tips[gap[0]] });
  lines.push('', verdict);
  return lines.join('\n');
}

/**
 * The coach's reply after you answer the check-in (shown in the feed).
 *   answer: { studied: bool|null, trained: bool|null }
 */
export function checkinReply(answer, ctx) {
  const { lang, stats, date } = ctx;
  const T = textFor(lang);
  const f = (str, vars) => fill(str, vars, lang);
  const plan = stats.planFor(date);
  const day = stats.day(date);
  const out = [];
  if (answer.studied === true) out.push(day.studyMin > 0 || plan.studyGoal === 0 ? T.reply.studiedYes : T.reply.studiedYesLog);
  if (answer.studied === false) {
    const tomorrow = stats.planFor(addDays(date, 1));
    const st = tomorrow.blocks.find((b) => b.kind === 'study');
    out.push(st ? f(T.reply.studiedNo, { time: st.start }) : T.reply.studiedNoLight);
  }
  if (answer.trained === true) out.push(T.reply.trainedYes);
  if (answer.trained === false) {
    if (plan.gym) {
      const next = nextGymDay(date, stats);
      out.push(f(T.reply.trainedNo, { day: next ? weekdayName(next, lang) : '–' }));
    } else out.push(T.reply.trainedNoRest);
  }
  return out.join(' ');
}

/** Exposed for the app (e.g. a "test notification" title). */
export const coachText = (lang) => textFor(lang);
export { weekdayOf };
