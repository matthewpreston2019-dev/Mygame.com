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

  // Fixed blocks the others must not overlap, as [start, end) minutes. A block
  // that would overlap one starts right after it instead.
  const busy = [];
  if (plan.exam?.time) busy.push([toMinutes(plan.exam.time), toMinutes(plan.exam.time) + EXAM_MIN]);
  const firstFreeAt = (at, len) => {
    for (let moved = true; moved;) {
      moved = false;
      for (const [a, b] of busy) if (at < b && at + len > a) { at = b; moved = true; }
    }
    return at;
  };

  if (type === 'short' || type === 'long') {
    const free = isHHMM(o?.free_from) ? o.free_from : s.freeFrom?.[type] || '15:00';
    plan.freeFrom = free;
    if (isHHMM(s.schoolStart) && toMinutes(s.schoolStart) < toMinutes(free)) {
      add({ id: 'school', kind: 'school', start: s.schoolStart, end: free });
    }

    // Lay out the after-school blocks in your chosen order (jumping over an
    // exam) and make sure they finish by check-in time. If they don't fit,
    // trim in this order: shorter break → shorter study (min 30) → move gym
    // to another day → whatever study still fits → whatever break still fits.
    // Check-in time is the cutoff; a missing/invalid one (or 00:00, which
    // would leave no evening at all) falls back to 21:00.
    const ci = toMinutes(s.checkinAt);
    const cutoff = Number.isFinite(ci) && ci > 0 ? ci : 21 * 60;
    const order = Array.isArray(s.order) && s.order.length ? s.order : ['relax', 'gym', 'study'];
    let relax = Number(s.relaxMin?.[type] ?? 60);
    let gymOn = !!gym;
    let st = study;
    const lengthOf = (step) => (step === 'relax' ? relax : step === 'gym' ? (gymOn ? s.gymMin + s.afterGymMin : 0) : step === 'study' ? st : 0);
    // Walks through the blocks (calling place(step, start) for each) and
    // returns how many minutes the last one ends after the cutoff.
    const layout = (place) => {
      let at = toMinutes(free);
      for (const step of order) {
        const len = lengthOf(step);
        if (len <= 0) continue;
        at = firstFreeAt(at, len);
        if (place) place(step, at);
        at += len;
      }
      return at - cutoff;
    };
    if (layout() > 0) { plan.trimmed = true; relax = Math.min(relax, SHORT_RELAX); }
    if (layout() > 0 && st > 30) st = Math.max(30, st - layout());
    if (layout() > 0 && gymOn) { gymOn = false; plan.gymMoved = true; st = study; }
    // Shortening a block can change where it lands around an exam, so a few rounds.
    for (let i = 0; i < 3 && layout() > 0; i++) st = Math.max(0, st - layout());
    // Not even the break fits (e.g. an evening exam): keep what's left, maybe nothing.
    for (let i = 0; i < 3 && layout() > 0; i++) relax = Math.max(0, relax - layout());
    if (st < MIN_STUDY_BLOCK) st = 0;
    if (!gymOn) gym = null;
    study = st;

    layout((step, at) => {
      if (step === 'relax') {
        add({ id: 'relax', kind: 'relax', start: toHHMM(at), end: toHHMM(at + relax) });
      } else if (step === 'gym') {
        add({ id: 'gym', kind: 'gym', start: toHHMM(at), end: toHHMM(at + s.gymMin), split: gym });
        add({ id: 'refuel', kind: 'refuel', start: toHHMM(at + s.gymMin), end: toHHMM(at + s.gymMin + s.afterGymMin) });
      } else if (step === 'study') {
        add({ id: 'study', kind: 'study', start: toHHMM(at), end: toHHMM(at + study), minutes: study, focus: plan.studyFocus });
      }
    });
  } else if (type === 'weekend') {
    if (study > 0 && isHHMM(s.weekendStudyAt)) {
      const st = firstFreeAt(toMinutes(s.weekendStudyAt), study);
      busy.push([st, st + study]);
      add({ id: 'study', kind: 'study', start: toHHMM(st), end: toHHMM(st + study), minutes: study, focus: plan.studyFocus });
    }
    if (gym && isHHMM(s.weekendGymAt)) {
      const st = firstFreeAt(toMinutes(s.weekendGymAt), s.gymMin);
      add({ id: 'gym', kind: 'gym', start: toHHMM(st), end: toHHMM(st + s.gymMin), split: gym, catchUp: plan.gymCatchUp });
    }
  }

  plan.gym = gym;
  plan.studyGoal = study;

  // Evening anchors — every day.
  if (isHHMM(s.checkinAt)) add({ id: 'checkin', kind: 'checkin', start: s.checkinAt, end: s.checkinAt });
  if (isHHMM(s.windDownAt)) add({ id: 'winddown', kind: 'winddown', start: s.windDownAt, end: s.lightsOut || s.windDownAt });
  if (isHHMM(s.lightsOut)) add({ id: 'sleep', kind: 'sleep', start: s.lightsOut, end: s.lightsOut });
  // Lights out after midnight (00:00–04:00, e.g. 00:30): the wind-down runs
  // past midnight and sleep comes last, so both still belong to this day.
  // Any other lights out before wind-down is a settings mix-up (Settings
  // rejects it): the wind-down then simply has no length.
  const afterMidnight = (min) => min <= 240;
  const windDown = blocks.find((b) => b.id === 'winddown');
  const sleep = blocks.find((b) => b.id === 'sleep');
  if (windDown && windDown.endMin < windDown.startMin) windDown.endMin = afterMidnight(windDown.endMin) ? windDown.endMin + 1440 : windDown.startMin;
  if (windDown && sleep && sleep.startMin < windDown.startMin && afterMidnight(sleep.startMin)) { sleep.startMin += 1440; sleep.endMin += 1440; }

  plan.blocks = blocks.sort((a, b) => a.startMin - b.startMin || (a.kind === 'school' ? -1 : 1));
  return plan;
}

/** The block happening at `minutes` (or the next one), for "Now / Next" cards. */
export function nowAndNext(plan, minutes) {
  const now = plan.blocks.find((b) => b.startMin <= minutes && minutes < b.endMin) || null;
  const next = plan.blocks.find((b) => b.startMin > minutes) || null;
  return { now, next };
}
