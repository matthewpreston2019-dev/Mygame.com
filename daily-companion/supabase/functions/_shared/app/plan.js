// =============================================================================
// Day planner — turns your schedule + any changes for a day into a plan.
// -----------------------------------------------------------------------------
// Used by the Today screen, the Calendar, and the server-side coach (so the
// push messages always match what the app shows). Shared with the server —
// keep it free of browser APIs.
//
// A plan looks like:
// {
//   date: '2026-10-21', type: 'short' | 'long' | 'weekend' | 'rest',
//   freeFrom: '14:30' | null,
//   gym: 'upper' | null,       // template key/id of today's split
//   gymCatchUp: false,         // weekend session to make up a missed one
//   gymMoved: false,           // no room for gym today (late finish)
//   studyGoal: 120,            // minutes planned today
//   studyFocus: 'Math' | null, // exam tomorrow → study is exam prep
//   exam: { subject, time } | null, examTomorrow: { subject, time } | null,
//   trimmed: false,            // blocks were shortened to fit the evening
//   note: '',                  // your note from the planner
//   blocks: [{ id, kind, start: 'HH:MM', end: 'HH:MM', startMin, endMin, ... }]
// }
// =============================================================================

import { weekdayOf, weekStart, addDays, toMinutes, toHHMM, isHHMM } from './time.js';

const EXAM_MIN = 90;          // assumed exam length for the calendar block
const MIN_STUDY_BLOCK = 20;   // shorter than this isn't worth scheduling
const SHORT_RELAX = 20;       // relax time when the evening is tight

/** Validates an exam object from the planner. */
export function validExam(exam) {
  if (!exam || typeof exam !== 'object') return null;
  const subject = String(exam.subject || '').trim().slice(0, 60);
  const time = isHHMM(exam.time) ? exam.time : null;
  if (!subject && !time) return null;
  return { subject, time };
}

const live = (row) => (row && !row.deleted ? row : null);

/**
 * How the week's gym sessions are going, as of the start of `date`.
 * Used to suggest a weekend catch-up session when you're behind.
 *  workouts – workout rows that count (see countsAsWorkout in stats.js)
 */
export function gymWeekInfo(date, settings, workouts) {
  const gymDays = settings.schedule.gymDays || {};
  const ws = weekStart(date);
  const scheduledSoFar = [];
  for (let d = ws; d < date; d = addDays(d, 1)) {
    const split = gymDays[weekdayOf(d)];
    if (split) scheduledSoFar.push(split);
  }
  const plannedWeek = Object.values(gymDays).filter(Boolean).length;
  const done = workouts.filter((w) => w.date >= ws && w.date < date).length;
  const behind = Math.max(0, Math.min(scheduledSoFar.length, plannedWeek) - done);
  const allSplits = Object.keys(gymDays).sort((a, b) => ((+a + 6) % 7) - ((+b + 6) % 7)).map((k) => gymDays[k]).filter(Boolean);
  return {
    done, plannedWeek, behind,
    // The first split you haven't done yet this week.
    nextSplit: scheduledSoFar[done] || allSplits[done % Math.max(1, allSplits.length)] || null,
  };
}

/** Next date after `date` (within a week) that has gym in the schedule, or null. */
export function nextGymDate(date, settings) {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(date, i);
    if (settings.schedule.gymDays?.[weekdayOf(d)]) return d;
  }
  return null;
}

/**
 * Build the plan for one day.
 * @param {object} p
 * @param {string} p.date
 * @param {object} p.settings      merged settings (see defaults.js)
 * @param {object} [p.override]    day_plans row for this date
 * @param {object} [p.nextOverride] day_plans row for the next date
 * @param {object} [p.gymWeek]     result of gymWeekInfo (enables catch-up)
 */
export function buildDayPlan({ date, settings, override, nextOverride, gymWeek }) {
  const s = settings.schedule;
  const wd = weekdayOf(date);
  const o = live(override);
  const next = live(nextOverride);

  const type = o?.day_type || s.days?.[wd] || 'weekend';
  const plan = {
    date, weekday: wd, type,
    overridden: !!(o && (o.day_type || o.free_from || o.skip_gym || o.skip_study || validExam(o.exam))),
    freeFrom: null,
    gym: null, gymCatchUp: false, gymMoved: false,
    studyGoal: 0, studyFocus: null,
    exam: validExam(o?.exam),
    examTomorrow: validExam(next?.exam),
    trimmed: false,
    note: (o?.note || '').trim(),
    blocks: [],
  };

  // ---- Gym -----------------------------------------------------------------
  let gym = type === 'rest' || o?.skip_gym ? null : s.gymDays?.[wd] || null;
  if (!gym && type === 'weekend' && !o?.skip_gym && gymWeek?.behind > 0 && gymWeek.nextSplit) {
    gym = gymWeek.nextSplit;
    plan.gymCatchUp = true;
  }

  // ---- Study goal ----------------------------------------------------------
  let study = type === 'rest' ? 0 : Number(s.studyMin?.[type] ?? 0);
  // Exam tomorrow on a tired day: a bit more than the light review, still light.
  if (plan.examTomorrow && type === 'long') study = Math.max(study, 60);
  // Exam today: you already did the hard part — lighter study afterwards.
  if (plan.exam) study = Math.round(study / 2 / 15) * 15;
  if (o?.skip_study) study = 0;
  plan.studyFocus = plan.examTomorrow?.subject || null;

  const blocks = [];
  const add = (b) => blocks.push({ ...b, startMin: toMinutes(b.start), endMin: toMinutes(b.end) });

  if (plan.exam?.time) {
    const st = toMinutes(plan.exam.time);
    add({ id: 'exam', kind: 'exam', start: plan.exam.time, end: toHHMM(st + EXAM_MIN), subject: plan.exam.subject });
  }

  if (type === 'short' || type === 'long') {
    const free = isHHMM(o?.free_from) ? o.free_from : s.freeFrom?.[type] || '15:00';
    plan.freeFrom = free;
    if (isHHMM(s.schoolStart) && toMinutes(s.schoolStart) < toMinutes(free)) {
      add({ id: 'school', kind: 'school', start: s.schoolStart, end: free });
    }

    // Lay out the after-school blocks in your chosen order and make sure they
    // finish by check-in time. If they don't fit, trim in this order:
    // shorter break → shorter study (min 30) → move gym to another day →
    // whatever study still fits.
    const cutoff = toMinutes(s.checkinAt) || 21 * 60;
    const start = toMinutes(free);
    let relax = Number(s.relaxMin?.[type] ?? 60);
    let gymOn = !!gym;
    let st = study;
    const total = () => relax + (gymOn ? s.gymMin + s.afterGymMin : 0) + st;
    if (start + total() > cutoff) { plan.trimmed = true; relax = Math.min(relax, SHORT_RELAX); }
    if (start + total() > cutoff && st > 30) st = Math.max(30, st - (start + total() - cutoff));
    if (start + total() > cutoff && gymOn) { gymOn = false; plan.gymMoved = true; st = study; }
    if (start + total() > cutoff) st = Math.max(0, cutoff - start - relax);
    if (st < MIN_STUDY_BLOCK) st = 0;
    if (!gymOn) gym = null;
    study = st;

    let cursor = start;
    const order = Array.isArray(s.order) && s.order.length ? s.order : ['relax', 'gym', 'study'];
    for (const step of order) {
      if (step === 'relax' && relax > 0) {
        add({ id: 'relax', kind: 'relax', start: toHHMM(cursor), end: toHHMM(cursor + relax) });
        cursor += relax;
      } else if (step === 'gym' && gymOn) {
        add({ id: 'gym', kind: 'gym', start: toHHMM(cursor), end: toHHMM(cursor + s.gymMin), split: gym });
        cursor += s.gymMin;
        add({ id: 'refuel', kind: 'refuel', start: toHHMM(cursor), end: toHHMM(cursor + s.afterGymMin) });
        cursor += s.afterGymMin;
      } else if (step === 'study' && study > 0) {
        add({ id: 'study', kind: 'study', start: toHHMM(cursor), end: toHHMM(cursor + study), minutes: study, focus: plan.studyFocus });
        cursor += study;
      }
    }
  } else if (type === 'weekend') {
    if (study > 0 && isHHMM(s.weekendStudyAt)) {
      const st = toMinutes(s.weekendStudyAt);
      add({ id: 'study', kind: 'study', start: s.weekendStudyAt, end: toHHMM(st + study), minutes: study, focus: plan.studyFocus });
    }
    if (gym && isHHMM(s.weekendGymAt)) {
      const st = toMinutes(s.weekendGymAt);
      add({ id: 'gym', kind: 'gym', start: s.weekendGymAt, end: toHHMM(st + s.gymMin), split: gym, catchUp: plan.gymCatchUp });
    }
  }

  plan.gym = gym;
  plan.studyGoal = study;

  // Evening anchors — every day.
  if (isHHMM(s.checkinAt)) add({ id: 'checkin', kind: 'checkin', start: s.checkinAt, end: s.checkinAt });
  if (isHHMM(s.windDownAt)) add({ id: 'winddown', kind: 'winddown', start: s.windDownAt, end: s.lightsOut || s.windDownAt });
  if (isHHMM(s.lightsOut)) add({ id: 'sleep', kind: 'sleep', start: s.lightsOut, end: s.lightsOut });

  plan.blocks = blocks.sort((a, b) => a.startMin - b.startMin || (a.kind === 'school' ? -1 : 1));
  return plan;
}

/** The block happening at `minutes` (or the next one), for "Now / Next" cards. */
export function nowAndNext(plan, minutes) {
  const now = plan.blocks.find((b) => b.startMin <= minutes && minutes < b.endMin) || null;
  const next = plan.blocks.find((b) => b.startMin > minutes) || null;
  return { now, next };
}
