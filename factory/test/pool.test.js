// The parallel pool, in demo mode (simulated output, no API calls).
import './setup-demo.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db, load, readResult } from '../server/core/store.js';
import { seed } from '../server/factory/world.js';
import { createTask } from '../server/factory/tasks.js';
import { enqueue, cancel } from '../server/factory/pool.js';
import { handleMessage } from '../server/factory/manager.js';
import { until } from './setup.js';

load();
seed();
const project = (cloudId) => db.projects.find((p) => p.cloudId === cloudId).id;
const make = (cloudId, worker, title, extra = {}) => createTask({ cloudId, projectId: project(cloudId), worker, title, instruction: title, ...extra });

test('independent tasks run at the same time, never more than the limit', async () => {
  db.settings.maxParallel = 2;
  const tasks = [make('gaming', 'research', 'A'), make('content', 'content', 'B'), make('finance', 'finance', 'C')];
  let peak = 0;
  const watch = setInterval(() => (peak = Math.max(peak, db.tasks.filter((t) => t.status === 'running').length)), 5);
  enqueue(tasks);
  await until(() => tasks.every((t) => t.status === 'done'));
  clearInterval(watch);
  assert.equal(peak, 2, 'two ran together, the third waited for a free slot');
  for (const t of tasks) {
    assert.ok(readResult(t.resultPath).includes(`# ${t.title}`), 'result file written');
    assert.match(t.resultPath, new RegExp(`^results/${t.cloudId}/`), 'stored under its cloud');
  }
});

test('a dependent task waits for and receives the result it needs', async () => {
  db.settings.maxParallel = 3;
  const research = make('research', 'research', 'Market research');
  const plan = make('finance', 'finance', 'Business plan', { dependsOn: [research.id] });
  const other = make('content', 'content', 'Unrelated video idea');
  enqueue([research, plan, other]);
  await until(() => plan.status === 'waiting' || plan.status === 'running');
  assert.notEqual(other.status, 'queued', 'independent task did not wait');
  await until(() => [research, plan, other].every((t) => t.status === 'done'));
  assert.ok(Date.parse(plan.startedAt) >= Date.parse(research.finishedAt), 'started after its dependency finished');
});

test('a failed dependency fails its dependants instead of leaving them stuck', async () => {
  const first = make('research', 'research', 'Will be cancelled');
  const second = make('finance', 'finance', 'Needs the first', { dependsOn: [first.id] });
  enqueue([first, second]);
  cancel(first);
  await until(() => second.status === 'failed');
});

test('chat → plan → parallel tasks → verified results, and identical work is reused', async () => {
  const reply = await handleMessage('Research Minecraft server trends and write a YouTube script');
  assert.equal(reply.taskIds.length, 2);
  const tasks = reply.taskIds.map((id) => db.tasks.find((t) => t.id === id));
  await until(() => tasks.every((t) => t.status === 'done'));
  assert.ok(tasks.every((t) => t.verified === true));

  const again = await handleMessage('Research Minecraft server trends');
  const reused = db.tasks.find((t) => t.id === again.taskIds[0]);
  assert.equal(reused.status, 'done');
  assert.equal(reused.reusedFrom, tasks[0].id);
  assert.equal(reused.resultPath, tasks[0].resultPath, 'no duplicate file');
});
