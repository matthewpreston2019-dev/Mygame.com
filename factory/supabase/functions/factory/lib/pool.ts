// The worker pool: runs independent tasks at the same time, up to the parallel limit.
//
// claim_tasks() (SQL) picks what may start now. Each claimed task is handed to its own
// function invocation, so workers genuinely run in parallel. When a task ends, the pool
// is checked again so waiting tasks start straight away. No polling.
import { db, must, getSecret, getTask, updateTask, FUNCTIONS_URL, now, sleep, log } from './db.ts';
import { LimitError } from './ai.ts';
import { runTask } from './worker.ts';

const MAX_ATTEMPTS = 3;

export async function dispatch() {
  const claimed = must(await db.rpc('claim_tasks')) as { id: string; title: string }[];
  await Promise.all(claimed.map((t) => handOff(t.id)));
}

async function handOff(id: string) {
  const key = await getSecret('internal_key');
  const res = await fetch(`${FUNCTIONS_URL}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-factory-key': key! }, body: JSON.stringify({ id }) }).catch(() => null);
  if (!res?.ok) {
    // Couldn't start it: put it back; the scheduler will try again within 5 minutes.
    await updateTask(id, { status: 'queued', stage: 'Queued · retrying start' });
    await log('error', 'pool.handoff_failed', { task: id, status: res?.status ?? 'network' });
  }
}

/** Runs inside the task's own invocation (see index.ts /run). */
export async function runAndContinue(id: string) {
  let wait = 0;
  try {
    await runTask(id);
  } catch (err) {
    wait = await onFailure(id, err as Error);
  }
  // A short retry delay is waited out here; longer ones are picked up by the scheduler.
  if (wait > 0 && wait <= 60_000) await sleep(wait);
  await dispatch().catch((err) => log('error', 'pool.dispatch_failed', { error: err.message }));
}

async function onFailure(id: string, err: Error & { retryable?: boolean; retryAfterMs?: number; status?: number }) {
  const task = await getTask(id);
  if (!task || task.status === 'cancelled') return 0;

  if (err instanceof LimitError) {
    await updateTask(id, { status: 'blocked', stage: 'Paused · daily AI allowance used', error: err.message });
    await log('error', 'task.paused', { task: id, title: task.title, error: err.message });
    return 0;
  }
  if (err.retryable && task.attempts < MAX_ATTEMPTS) {
    const delay = Math.max(err.retryAfterMs ?? 0, 10_000 * 2 ** task.attempts);
    await updateTask(id, { status: 'queued', stage: `Retrying in ${Math.round(delay / 1000)}s`, error: err.message, not_before: new Date(Date.now() + delay).toISOString() });
    await log('error', 'task.retry', { task: id, attempt: task.attempts, error: err.message });
    return delay;
  }
  await updateTask(id, { status: 'failed', stage: 'Failed', error: err.message, finished_at: now() });
  await log('error', 'task.failed', { task: id, title: task.title, error: err.message });
  return 0;
}

export async function cancelTask(id: string) {
  const task = await getTask(id);
  if (!task || !['queued', 'waiting', 'running', 'blocked'].includes(task.status)) return false;
  await updateTask(id, { status: 'cancelled', stage: 'Cancelled', finished_at: now() });
  await dispatch(); // dependants fail, and the freed slot goes to the next task
  return true;
}

export async function retryTask(id: string) {
  const task = await getTask(id);
  if (!task || !['failed', 'cancelled', 'blocked'].includes(task.status)) return false;
  await updateTask(id, { status: 'queued', stage: 'Queued', error: null, attempts: 0, not_before: null, finished_at: null, progress: 0 });
  // Tasks that failed only because this one did get another chance too.
  must(await db.from('tasks').update({ status: 'queued', stage: 'Queued', error: null, attempts: 0, finished_at: null }).eq('status', 'failed').contains('depends_on', [id]));
  await dispatch();
  return true;
}

/** After the daily limit is raised: continue everything that was paused. */
export async function resumePaused() {
  must(await db.from('tasks').update({ status: 'queued', stage: 'Queued', error: null }).eq('status', 'blocked'));
  await dispatch();
}
