// =============================================================================
// Workouts: start today's split, log sets (kg × reps) with last session's
// numbers shown as targets, rest timer, personal records, history.
// =============================================================================

import { html, useEffect, useState } from '../../lib/preact.js';
import * as store from '../../lib/store.js';
import { t, fmtNum, fmtDate, fmtClock, getLang } from '../../lib/i18n.js';
import { useClock } from '../../lib/clock.js';
import { navigate } from '../../lib/router.js';
import { exerciseName, templateName, findTemplate } from '../../shared/names.js';
import { Empty, SheetFrame, confirmDialog } from '../../components/common.js';
import { Icon } from '../../components/icons.js';
import { openSheet, toast, confetti, haptic } from '../../lib/ui.js';
import { ExercisePicker } from '../settings/templates.js';
import { num, wholeNum } from './numbers.js';

const LIVE_HOURS = 8;          // an unfinished workout older than this is treated as finished
const REST_SECONDS = 90;

/** Estimated one-rep max (Epley). Used to spot strength PRs across rep ranges. */
export const e1rm = (w, r) => (w > 0 && r > 0 ? w * (1 + Math.min(r, 12) / 30) : 0);

const doneSets = () => store.rows('workout_sets').filter((s) => s.done && s.reps > 0);
const fmtW = (w) => fmtNum(Number(w), 2);

/** Your previous performance for an exercise, excluding one workout. */
function history(exId, excludeWorkoutId) {
  const workouts = new Map(store.rows('workouts').map((w) => [w.id, w]));
  const sets = doneSets().filter((s) => s.exercise === exId && s.workout_id !== excludeWorkoutId && workouts.has(s.workout_id));
  let best = { weight: 0, reps: 0, e1rm: 0, repsAtZero: 0 };
  for (const s of sets) {
    const w = Number(s.weight) || 0;
    if (w > best.weight || (w === best.weight && s.reps > best.reps)) best = { ...best, weight: w, reps: s.reps };
    best.e1rm = Math.max(best.e1rm, e1rm(w, s.reps));
    if (!w) best.repsAtZero = Math.max(best.repsAtZero, s.reps);
  }
  // The most recent other workout that has this exercise.
  const byWorkout = new Map();
  for (const s of sets) {
    if (!byWorkout.has(s.workout_id)) byWorkout.set(s.workout_id, []);
    byWorkout.get(s.workout_id).push(s);
  }
  let last = null;
  for (const [wid, list] of byWorkout) {
    const w = workouts.get(wid);
    if (!last || w.date > last.workout.date || (w.date === last.workout.date && w.started_at > last.workout.started_at)) last = { workout: w, sets: list.sort((a, b) => a.set_index - b.set_index) };
  }
  return { best, last, count: sets.length };
}

/** An unfinished workout from the last few hours (to continue it). */
function liveWorkout() {
  const cutoff = Date.now() - LIVE_HOURS * 3600e3;
  return store.rows('workouts').filter((w) => !w.ended_at && Date.parse(w.started_at) > cutoff)
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0] || null;
}

function startWorkout(tpl, date) {
  const live = liveWorkout();
  if (live && live.template_id === tpl.id) return navigate(`track/workout/${live.id}`);
  // Throw away an abandoned empty workout instead of leaving it lying around.
  if (live && !store.rows('workout_sets').some((s) => s.workout_id === live.id)) store.remove('workouts', { id: live.id });
  const w = store.put('workouts', { date, template_id: tpl.id, started_at: new Date().toISOString() });
  navigate(`track/workout/${w.id}`);
}

export function WorkoutSection() {
  const { date } = useClock();
  const lang = getLang();
  const plan = store.stats().planFor(date);
  const templates = store.rows('workout_templates').slice().sort((a, b) => a.sort - b.sort);
  const planned = plan.gym ? findTemplate(plan.gym, templates) : null;
  const live = liveWorkout();
  const others = templates.filter((x) => x.id !== planned?.id);

  return html`
    ${live && html`<div class="card gold mb-12">
      <div class="row">
        <span style="font-size:26px">🏋️</span>
        <div class="grow"><div class="bold">${t('workout.inProgress')}</div>
          <div class="small muted">${templateName(findTemplate(live.template_id, templates), lang)} · ${t('workout.startedAt', { time: fmtClock(live.started_at, store.settings().timezone) })}</div></div>
        <button class="btn primary" onClick=${() => navigate(`track/workout/${live.id}`)}>${t('workout.continue')}</button>
      </div></div>`}

    ${planned && !(live && live.template_id === planned.id) && html`<div class="card accent">
      <div class="small muted">${plan.gymCatchUp ? t('plan.catchUp') : t('workout.todaysSplit')}</div>
      <div class="bold" style="font-size:22px;margin:2px 0 4px">${templateName(planned, lang)}</div>
      <div class="small faint ellipsis">${(planned.exercises || []).map((e) => exerciseName(e, lang)).join(' · ')}</div>
      <button class="btn primary block mt-12" onClick=${() => startWorkout(planned, date)}><${Icon} name="play" />${t('workout.startSplit', { split: templateName(planned, lang) })}</button>
    </div>`}
    ${!planned && html`<div class="card"><p class="muted small">${t('workout.restDay')}</p></div>`}

    ${(others.length > 0 || !planned) && html`<div class="section-title">${planned ? t('workout.otherTemplates') : t('workout.startAny')}</div>
      <div class="list">${(planned ? others : templates).map((tp) => html`<button class="li" onClick=${() => startWorkout(tp, date)}>
        <span class="li-icon"><${Icon} name="dumbbell" /></span>
        <span class="grow label">${templateName(tp, lang)}</span><${Icon} name="play" class="chev" /></button>`)}</div>`}

    <${History} />
    <${Records} />`;
}

function History() {
  const lang = getLang();
  const stats = store.stats();
  const templates = store.rows('workout_templates');
  const list = stats.countedWorkouts.slice().sort((a, b) => b.date.localeCompare(a.date) || String(b.started_at).localeCompare(String(a.started_at))).slice(0, 12);
  if (!list.length) return html`<${Empty} emoji="🏋️" title=${t('workout.emptyTitle')} text=${t('workout.emptyText')} />`;
  return html`<div class="section-title">${t('workout.history')}</div>
    <div class="list">${list.map((w) => {
      const sets = (stats.setsByWorkout.get(w.id) || []).filter((s) => s.done);
      const vol = sets.reduce((a, s) => a + (Number(s.weight) || 0) * (s.reps || 0), 0);
      const tpl = findTemplate(w.template_id, templates);
      return html`<button class="li" onClick=${() => navigate(`track/workout/${w.id}`)}>
        <span class="grow"><div class="label">${tpl ? templateName(tpl, lang) : t('workout.workout')}</div>
          <div class="sub">${fmtDate(w.date, 'short')} · ${t('workout.setsN', { n: sets.length })}</div></span>
        <span class="value">${fmtNum(Math.round(vol))} kg</span><${Icon} name="chev" class="chev" /></button>`;
    })}</div>`;
}

function Records() {
  const lang = getLang();
  const byEx = new Map();
  for (const s of doneSets()) {
    const w = Number(s.weight) || 0;
    const cur = byEx.get(s.exercise) || { weight: -1, reps: 0, e1: 0, date: null };
    if (w > cur.weight || (w === cur.weight && s.reps > cur.reps)) Object.assign(cur, { weight: w, reps: s.reps });
    cur.e1 = Math.max(cur.e1, e1rm(w, s.reps));
    byEx.set(s.exercise, cur);
  }
  if (!byEx.size) return null;
  // Show names from templates (custom exercises carry their name there).
  const named = new Map();
  for (const tp of store.rows('workout_templates')) for (const e of tp.exercises || []) named.set(e.id, e);
  const rows = [...byEx.entries()].map(([id, r]) => ({ id, name: exerciseName(named.get(id) || id, lang), ...r })).sort((a, b) => a.name.localeCompare(b.name));
  return html`<div class="section-title">🏆 ${t('workout.records')}</div>
    <div class="list">${rows.map((r) => html`<div class="li">
      <span class="grow"><div class="label">${r.name}</div>${r.e1 > 0 && html`<div class="sub">${t('workout.e1rm', { n: fmtNum(Math.round(r.e1 * 2) / 2, 1) })}</div>`}</span>
      <span class="value bold" style="color:var(--gold)">${r.weight > 0 ? `${fmtW(r.weight)} kg × ${r.reps}` : t('workout.repsOnly', { n: r.reps })}</span>
    </div>`)}</div>`;
}

// ---- Session -------------------------------------------------------------------

export function WorkoutSession({ id }) {
  const lang = getLang();
  const s = store.settings();
  const workout = store.find('workouts', { id });
  const [added, setAdded] = useState([]);
  const [, tick] = useState(0);
  useEffect(() => { const iv = setInterval(() => tick((x) => x + 1), 15000); return () => clearInterval(iv); }, []);

  if (!workout) {
    return html`<div class="screen"><${Empty} emoji="🤷" title=${t('workout.notFound')} action=${html`<button class="btn" onClick=${() => navigate('track/workout')}>${t('common.back')}</button>`} /></div>`;
  }
  const tpl = findTemplate(workout.template_id, store.rows('workout_templates'));
  const sets = store.rows('workout_sets').filter((x) => x.workout_id === id);
  const exercises = [];
  const seen = new Set();
  for (const e of [...(tpl?.exercises || []), ...added]) if (!seen.has(e.id)) { seen.add(e.id); exercises.push(e); }
  for (const x of sets) if (!seen.has(x.exercise)) { seen.add(x.exercise); exercises.push({ id: x.exercise, sets: 3, reps: '' }); }

  const finished = !!workout.ended_at || Date.parse(workout.started_at) < Date.now() - LIVE_HOURS * 3600e3;
  const elapsed = Math.round((Date.now() - Date.parse(workout.started_at)) / 60000);
  const done = sets.filter((x) => x.done);
  const volume = done.reduce((a, x) => a + (Number(x.weight) || 0) * (x.reps || 0), 0);

  async function addExercise() {
    const ex = await openSheet(({ close }) => html`<${ExercisePicker} close=${close} existing=${exercises.map((e) => e.id)} />`);
    if (ex) setAdded([...added, { ...ex, sets: 3, reps: '8-12' }]);
  }

  function finish() {
    store.put('workouts', { id, ended_at: new Date().toISOString() });
    stopRest();
    if (done.length) toast(t('workout.finished', { n: done.length, kg: fmtNum(Math.round(volume)) }), { type: 'xp', duration: 3500 });
    navigate('track/workout');
  }

  async function del() {
    if (!(await confirmDialog({ title: t('workout.delete'), text: t('workout.deleteText'), ok: t('common.delete'), danger: true }))) return;
    for (const x of sets) store.remove('workout_sets', { id: x.id });
    store.remove('workouts', { id });
    stopRest();
    navigate('track/workout');
  }

  return html`<div class="screen">
    <div class="screen-head">
      <button class="icon-btn" aria-label=${t('common.back')} onClick=${() => navigate('track/workout')}><${Icon} name="back" class="flip" /></button>
      <div class="grow">
        <h1 class="title" style="font-size:26px">${tpl ? templateName(tpl, lang) : t('workout.workout')}</h1>
        <div class="subtitle">${fmtDate(workout.date, 'short')} · ${finished
          ? (workout.ended_at ? t('workout.finishedAt', { time: fmtClock(workout.ended_at, s.timezone) }) : t('workout.done'))
          : t('workout.elapsed', { n: elapsed })}</div>
      </div>
      ${!finished && html`<button class="btn primary small" onClick=${finish}>${t('workout.finish')}</button>`}
    </div>

    <div class="stats mb-12" style="grid-template-columns:1fr 1fr">
      <div class="stat"><div class="v">${done.length}</div><div class="l">${t('workout.setsDone')}</div></div>
      <div class="stat"><div class="v">${fmtNum(Math.round(volume))}<small>kg</small></div><div class="l">${t('workout.volume')}</div></div>
    </div>

    ${exercises.map((ex) => html`<${ExerciseCard} key=${ex.id} workout=${workout} ex=${ex} sets=${sets.filter((x) => x.exercise === ex.id)} />`)}

    <button class="btn block mt-12" onClick=${addExercise}><${Icon} name="plus" />${t('templates.addExercise')}</button>
    ${!finished && html`<button class="btn primary block mt-12" onClick=${finish}><${Icon} name="check" />${t('workout.finish')}</button>`}
    <button class="btn danger block mt-12" onClick=${del}><${Icon} name="trash" />${t('workout.delete')}</button>
    <${RestTimer} />
  </div>`;
}

function ExerciseCard({ workout, ex, sets }) {
  const lang = getLang();
  const h = history(ex.id, workout.id);
  const lastSets = h.last?.sets || [];
  const maxIndex = sets.reduce((m, x) => Math.max(m, x.set_index + 1), 0);
  const [rows, setRows] = useState(Math.max(Number(ex.sets) || 3, maxIndex));
  const count = Math.max(rows, maxIndex);

  return html`<div class="card ex-card">
    <div class="ex-head">
      <h3>${exerciseName(ex, lang)}</h3>
      ${ex.sets && ex.reps && html`<span class="badge">${ex.sets} × ${ex.reps}</span>`}
    </div>
    ${h.last
      ? html`<div class="last">${t('workout.lastTime', { date: fmtDate(h.last.workout.date, 'dayMonth') })}: <b>${lastSets.map((x) => `${fmtW(x.weight || 0)}×${x.reps}`).join(' · ')}</b></div>`
      : html`<div class="last">${t('workout.firstTime')}</div>`}
    <div class="sets">
      <span class="hdr">#</span><span class="hdr">kg</span><span class="hdr">${t('workout.reps')}</span><span class="hdr">✓</span>
      ${Array.from({ length: count }, (_, i) => html`<${SetRow} key=${i} workout=${workout} ex=${ex} index=${i}
        row=${sets.find((x) => x.set_index === i)} prev=${lastSets[i] || lastSets[lastSets.length - 1]} best=${h.best} hasHistory=${h.count > 0} />`)}
    </div>
    <button class="link-btn mt-8" onClick=${() => setRows(count + 1)}>+ ${t('workout.addSet')}</button>
  </div>`;
}

function SetRow({ workout, ex, index, row, prev, best, hasHistory }) {
  const lang = getLang();
  const [w, setW] = useState(row?.weight != null ? String(Number(row.weight)) : '');
  const [r, setR] = useState(row?.reps != null ? String(row.reps) : '');
  // Follow changes that arrive from sync (another device), unless you're typing.
  useEffect(() => { if (row && document.activeElement?.dataset?.set !== `${ex.id}${index}`) { setW(row.weight != null ? String(Number(row.weight)) : ''); setR(row.reps != null ? String(row.reps) : ''); } }, [row?.updated_at]);

  const phW = prev?.weight != null ? String(Number(prev.weight)) : '';
  const phR = prev?.reps != null ? String(prev.reps) : '';

  function values() {
    const weight = w.trim() === '' ? (phW === '' ? 0 : num(phW)) : num(w);
    const reps = r.trim() === '' ? (phR === '' ? NaN : wholeNum(phR)) : wholeNum(r);
    return { weight, reps };
  }
  function valid({ weight, reps }) {
    if (!(Number.isFinite(weight) && weight >= 0 && weight <= 1000)) { toast(t('workout.badWeight'), { type: 'error' }); return false; }
    if (!(Number.isInteger(reps) && reps >= 1 && reps <= 1000)) { toast(t('workout.badReps'), { type: 'error' }); return false; }
    return true;
  }

  function save(fields) {
    return store.put('workout_sets', { ...(row ? { id: row.id } : {}), workout_id: workout.id, exercise: ex.id, set_index: index, ...fields });
  }

  function onTick() {
    if (row?.done) { save({ done: false }); return; }
    const v = values();
    if (!valid(v)) return;
    const weight = Math.round(v.weight * 100) / 100;
    setW(String(weight)); setR(String(v.reps));
    save({ weight, reps: v.reps, done: true });
    haptic(10);
    // Personal record?
    if (hasHistory) {
      const isPr = weight > 0
        ? weight > best.weight || e1rm(weight, v.reps) > best.e1rm + 0.01
        : best.weight === 0 && v.reps > best.repsAtZero;
      if (isPr) {
        confetti({ count: 110 });
        toast(t('workout.newPr', { ex: exerciseName(ex, lang), set: weight > 0 ? `${fmtW(weight)} kg × ${v.reps}` : `× ${v.reps}` }), { type: 'xp', duration: 3500 });
      }
    }
    startRest(REST_SECONDS);
  }

  // Editing a set you already ticked updates it when you leave the field.
  // Same rules as ticking: a bad value (e.g. 1025 kg or -3 reps) is not
  // saved. You get the same message and the saved numbers come back.
  function onBlur() {
    if (!row) return;
    const v = values();
    if (!valid(v)) {
      setW(row.weight != null ? String(Number(row.weight)) : '');
      setR(row.reps != null ? String(row.reps) : '');
      return;
    }
    const weight = Math.round(v.weight * 100) / 100;
    if (Number(row.weight) !== weight || row.reps !== v.reps) save({ weight, reps: v.reps });
  }

  return html`
    <span class="n">${index + 1}</span>
    <input class="input" data-set=${`${ex.id}${index}`} inputmode="decimal" placeholder=${phW} value=${w} onInput=${(e) => setW(e.currentTarget.value)} onBlur=${onBlur} aria-label="kg" />
    <input class="input" data-set=${`${ex.id}${index}`} inputmode="numeric" placeholder=${phR} value=${r} onInput=${(e) => setR(e.currentTarget.value)} onBlur=${onBlur} aria-label=${t('workout.reps')} />
    <button class=${`tick ${row?.done ? 'on' : ''}`} aria-label=${t('workout.tick')} aria-pressed=${!!row?.done} onClick=${onTick}><${Icon} name="check" /></button>`;
}

// ---- Rest timer ------------------------------------------------------------------
let restEndsAt = 0;
const restListeners = new Set();
function startRest(sec) { restEndsAt = Date.now() + sec * 1000; for (const fn of restListeners) fn(); }
function stopRest() { restEndsAt = 0; for (const fn of restListeners) fn(); }

function RestTimer() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((x) => x + 1);
    restListeners.add(fn);
    const iv = setInterval(() => {
      if (restEndsAt && Date.now() >= restEndsAt) { restEndsAt = 0; haptic(40); toast(t('workout.restOver'), { type: 'info' }); }
      fn();
    }, 500);
    return () => { restListeners.delete(fn); clearInterval(iv); };
  }, []);
  if (!restEndsAt) return null;
  const left = Math.max(0, Math.ceil((restEndsAt - Date.now()) / 1000));
  return html`<div class="rest-timer" role="timer">
    <span class="small muted">${t('workout.rest')}</span>
    <span class="tm grow">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span>
    <button class="btn small" onClick=${() => { restEndsAt += 30000; tick((x) => x + 1); }}>+30s</button>
    <button class="btn small" onClick=${stopRest}>${t('workout.skip')}</button>
  </div>`;
}

export { SheetFrame };
