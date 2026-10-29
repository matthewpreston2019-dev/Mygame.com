// Creating and updating tasks. Every change is saved and pushed live to the browser.
import { db, save, newId, now } from '../core/store.js';
import { emit } from '../http/events.js';

/**
 * Task lifecycle:
 *   new → queued → running → done
 *          ↘ waiting (for another task's result)   ↘ failed / cancelled
 *          ↘ blocked (budget reached — resumes when the limit is raised)
 */
export function createTask(fields) {
  const task = {
    id: newId('tsk'),
    batchId: null,
    scheduleId: null,
    cloudId: 'research',
    projectId: null,
    worker: 'research',
    title: 'Untitled task',
    instruction: '',
    tier: null,
    skillHint: '',
    dependsOn: [],
    status: 'new',
    progress: 0,
    stage: 'Created',
    attempts: 0,
    notBefore: null,
    error: null,
    resultPath: null,
    summary: '',
    verified: null,
    issues: [],
    reusedFrom: null,
    skillIds: [],
    sources: [],
    costUsd: 0,
    model: null,
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
    ...fields,
  };
  db.tasks.push(task);
  save();
  emit('task', task);
  return task;
}

export function updateTask(task, changes) {
  Object.assign(task, changes);
  save();
  emit('task', task);
  return task;
}

export const isActive = (t) => ['queued', 'waiting', 'running'].includes(t.status);
