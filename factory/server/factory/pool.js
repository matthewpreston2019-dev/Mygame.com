// The worker pool: runs independent tasks at the same time, up to a limit.
//
// - A task starts as soon as a slot is free and the tasks it depends on are done.
// - Independent tasks never wait for each other; only declared dependencies wait.
// - Event-driven: the pool re-checks when work is added or finishes. No polling.
import { db, findTask, now } from '../core/store.js';
import { config } from '../config.js';
import { log } from '../core/log.js';
import { BudgetError } from '../core/budget.js';
import { updateTask } from './tasks.js';
import { runTask } from './worker.js';

const running = new Map(); // taskId → AbortController
let wakeTimer = null;

export const runningCount = () => running.size;

export function enqueue(tasks) {
  for (const t of tasks) if (t.status === 'new') updateTask(t, { status: 'queued', stage: 'Queued' });
  pump();
}

export function pump() {
  clearTimeout(wakeTimer);
  let nextWake = Infinity;

  for (const task of db.tasks) {
    if ((task.status !== 'queued' && task.status !== 'waiting') || running.has(task.id)) continue;

    const deps = task.dependsOn.map(findTask);
    if (deps.some((d) => !d || d.status === 'failed' || d.status === 'cancelled')) {
      updateTask(task, { status: 'failed', stage: 'Failed', error: 'A task it depends on did not finish.', finishedAt: now() });
      continue;
    }
    const pending = deps.filter((d) => d.status !== 'done');
    if (pending.length) {
      const stage = `Waiting for ${pending.map((d) => d.title).join(', ')}`;
      if (task.stage !== stage) updateTask(task, { status: 'waiting', stage });
      continue;
    }
    if (task.notBefore && Date.parse(task.notBefore) > Date.now()) {
      nextWake = Math.min(nextWake, Date.parse(task.notBefore));
      continue;
    }
    if (running.size >= db.settings.maxParallel) {
      const stage = `Queued · ${running.size} workers busy`;
      if (task.stage !== stage || task.status !== 'queued') updateTask(task, { status: 'queued', stage });
      continue;
    }
    start(task);
  }

  if (nextWake < Infinity) wakeTimer = setTimeout(pump, Math.max(50, nextWake - Date.now())).unref();
}

async function start(task) {
  const controller = new AbortController();
  running.set(task.id, controller);
  updateTask(task, { status: 'running', progress: 5, stage: 'Starting', startedAt: now(), attempts: task.attempts + 1, error: null, notBefore: null });
  try {
    await runTask(task, controller.signal);
  } catch (err) {
    if (!controller.signal.aborted) onFailure(task, err);
  } finally {
    running.delete(task.id);
    pump();
  }
}

function onFailure(task, err) {
  if (task.status === 'cancelled') return;
  if (err instanceof BudgetError) {
    updateTask(task, { status: 'blocked', stage: 'Paused · budget reached', error: err.message });
    log.error('task.blocked', { task: task.id, error: err.message });
  } else if (err.retryable && task.attempts < config.maxAttempts) {
    const delay = 5000 * 2 ** task.attempts;
    updateTask(task, { status: 'queued', stage: `Retrying in ${delay / 1000}s`, error: err.message, notBefore: new Date(Date.now() + delay).toISOString() });
    log.error('task.retry', { task: task.id, attempt: task.attempts, error: err.message });
  } else {
    updateTask(task, { status: 'failed', stage: 'Failed', error: err.message, finishedAt: now() });
    log.error('task.failed', { task: task.id, title: task.title, error: err.message });
  }
}

export function cancel(task) {
  if (!['queued', 'waiting', 'running', 'blocked'].includes(task.status)) return false;
  updateTask(task, { status: 'cancelled', stage: 'Cancelled', finishedAt: now() });
  running.get(task.id)?.abort();
  pump();
  return true;
}

export function retry(task) {
  if (!['failed', 'cancelled', 'blocked'].includes(task.status)) return false;
  updateTask(task, { status: 'queued', stage: 'Queued', error: null, attempts: 0, notBefore: null, finishedAt: null, progress: 0 });
  // Dependants that failed only because of this task get another chance too.
  for (const t of db.tasks) {
    if (t.dependsOn.includes(task.id) && t.status === 'failed') updateTask(t, { status: 'queued', error: null, attempts: 0, finishedAt: null });
  }
  pump();
  return true;
}

/** After the budget is raised: continue everything that was paused. */
export function resumeBlocked() {
  for (const t of db.tasks) if (t.status === 'blocked') updateTask(t, { status: 'queued', stage: 'Queued', error: null });
  pump();
}

/** On start-up: work that was interrupted by a restart or crash is queued again. */
export function recover() {
  let count = 0;
  for (const t of db.tasks) {
    if (t.status === 'running' || t.status === 'new') {
      updateTask(t, { status: 'queued', stage: 'Recovered after restart', progress: 0 });
      count++;
    }
  }
  if (count) log.info('pool.recovered', { count });
  pump();
}
