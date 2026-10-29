// Schedules: the daily briefing and any recurring research or jobs.
//
// One timer is armed for the next due schedule (re-checked at most hourly), so nothing polls.
// If the server was off when a run was due, it runs once on start-up (no pile-up of missed runs).
import { db, save, newId, now, findProject } from '../core/store.js';
import { emit } from '../http/events.js';
import { log } from '../core/log.js';
import { createTask } from './tasks.js';
import { enqueue } from './pool.js';

let timer = null;

export function startScheduler() {
  for (const s of db.schedules) s.nextRun ??= nextRun(s);
  save();
  tick();
}

/** When should this schedule run next (as an ISO string), counted from `from`. */
export function nextRun(s, from = new Date()) {
  if (s.every === 'hourly') return new Date(from.getTime() + 3_600_000).toISOString();
  const [h, m] = String(s.at || '08:00').split(':').map(Number);
  const next = new Date(from);
  next.setHours(h || 0, m || 0, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  if (s.every === 'weekly') {
    const day = Number.isInteger(s.weekday) ? s.weekday : 1; // Monday
    while (next.getDay() !== day) next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function tick() {
  clearTimeout(timer);
  const due = db.schedules.filter((s) => s.enabled && Date.parse(s.nextRun) <= Date.now());
  for (const s of due) runSchedule(s);

  const upcoming = db.schedules.filter((s) => s.enabled).map((s) => Date.parse(s.nextRun));
  const wait = upcoming.length ? Math.min(...upcoming) - Date.now() : Infinity;
  timer = setTimeout(tick, Math.max(1000, Math.min(wait, 3_600_000))).unref(); // the HTTP server keeps the process alive
}

export function runSchedule(s) {
  s.lastRun = now();
  s.nextRun = nextRun(s);
  save();
  emit('schedule', s);

  const project = findProject(s.projectId);
  const task = createTask({
    scheduleId: s.id,
    cloudId: s.cloudId,
    projectId: project?.id || db.projects.find((p) => p.cloudId === s.cloudId)?.id,
    worker: s.worker,
    title: `${s.name} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
    instruction: s.kind === 'briefing' ? briefingInstruction() : recurringInstruction(s),
    tier: 'fast',
  });
  log.info('schedule.fired', { schedule: s.id, name: s.name, task: task.id });
  enqueue([task]);
  return task;
}

/** Recurring jobs report only what is new since the last run. */
function recurringInstruction(s) {
  const last = db.tasks.findLast((t) => t.scheduleId === s.id && t.status === 'done');
  return `${s.instruction}\n\n${last ? `Last run found: ${last.summary}\nReport only what is new or changed since then.` : 'This is the first run.'} If nothing meaningful changed, reply with one line saying so.`;
}

/** The briefing is built from the factory's own data, so it costs one small call. */
function briefingInstruction() {
  const since = Date.now() - 86_400_000;
  const done = db.tasks.filter((t) => t.status === 'done' && Date.parse(t.finishedAt) > since && t.summary && !t.title.startsWith('Daily briefing'));
  const failed = db.tasks.filter((t) => t.status === 'failed' && Date.parse(t.finishedAt) > since);
  const pending = db.approvals.filter((a) => a.status === 'pending');
  const lines = [
    'Write my daily briefing: a short greeting, then only what matters today. Keep it under 200 words.',
    '',
    `Finished in the last 24h:\n${done.map((t) => `- ${t.title}: ${t.summary}`).join('\n') || '- nothing'}`,
    `Failed:\n${failed.map((t) => `- ${t.title}: ${t.error}`).join('\n') || '- nothing'}`,
    `Waiting for my approval:\n${pending.map((a) => `- ${a.kind}: ${a.summary}`).join('\n') || '- nothing'}`,
    `Spent: $${db.spend.dayUsd.toFixed(2)} today, $${db.spend.monthUsd.toFixed(2)} this month.`,
  ];
  return lines.join('\n');
}

// ── Editing schedules ───────────────────────────────────

const EVERY = ['daily', 'weekly', 'hourly'];

export function addSchedule(fields) {
  if (!fields.instruction || !EVERY.includes(fields.every)) return null;
  const s = { id: newId('sch'), kind: 'task', enabled: true, lastRun: null, at: '08:00', ...fields };
  if (!/^\d{1,2}:\d{2}$/.test(s.at)) s.at = '08:00';
  s.nextRun = nextRun(s);
  db.schedules.push(s);
  save();
  emit('schedule', s);
  tick();
  return s;
}

export function updateSchedule(s, changes) {
  for (const key of ['name', 'instruction', 'at', 'every', 'enabled', 'weekday']) if (key in changes) s[key] = changes[key];
  if (!/^\d{1,2}:\d{2}$/.test(s.at)) s.at = '08:00';
  if (!EVERY.includes(s.every)) s.every = 'daily';
  s.nextRun = nextRun(s);
  save();
  emit('schedule', s);
  tick();
  return s;
}

export function removeSchedule(id) {
  db.schedules = db.schedules.filter((s) => s.id !== id);
  save();
  emit('schedule.removed', { id });
  tick();
}
