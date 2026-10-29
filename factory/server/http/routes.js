// The API. Every route is listed here so the whole surface is visible at a glance.
import { db, save, now, findTask, findProject, readResult, removeResult } from '../core/store.js';
import { log } from '../core/log.js';
import { spendStatus } from '../core/budget.js';
import { aiMode } from '../ai/claude.js';
import { config } from '../config.js';
import { subscribe, emit } from './events.js';
import { HttpError } from './server.js';
import { WORKERS } from '../factory/world.js';
import { handleMessage, resolveProject } from '../factory/manager.js';
import { cancel, retry, resumeBlocked, runningCount, pump } from '../factory/pool.js';
import { listSkills, deleteSkill, allSkills } from '../factory/skills.js';
import { decide } from '../factory/approvals.js';
import { addSchedule, updateSchedule, removeSchedule, runSchedule } from '../factory/scheduler.js';

const bootedAt = now();

export function status() {
  return { ai: aiMode(), models: config.models, running: runningCount(), maxParallel: db.settings.maxParallel, spend: spendStatus(), bootedAt, serverTime: now() };
}

/** Everything the interface needs on load. Old finished tasks are trimmed to keep it light. */
export function snapshot() {
  const active = db.tasks.filter((t) => !['done', 'failed', 'cancelled'].includes(t.status));
  const recent = db.tasks.filter((t) => ['done', 'failed', 'cancelled'].includes(t.status)).slice(-250);
  return {
    status: status(),
    clouds: db.clouds,
    projects: db.projects,
    workers: Object.fromEntries(Object.entries(WORKERS).map(([id, w]) => [id, { name: w.name, tier: w.tier, web: !!w.web }])),
    tasks: [...recent, ...active],
    approvals: db.approvals.slice(-60),
    schedules: db.schedules,
    skills: listSkills(),
    chat: db.chat.slice(-80),
    settings: db.settings,
  };
}

const must = (value, message = 'Not found') => {
  if (!value) throw new HttpError(404, message);
  return value;
};
const text = (v, max) => String(v ?? '').trim().slice(0, max);

export const routes = [
  ['GET', '/api/health', () => ({ ok: true, ai: aiMode() })],
  ['GET', '/api/state', () => snapshot()],
  ['GET', '/api/events', (req, { res }) => void subscribe(req, res, snapshot())],

  // Chat → manager
  ['POST', '/api/chat', async (req, { body }) => {
    const message = text(body.text, 4000);
    if (!message) throw new HttpError(400, 'Message is empty');
    return handleMessage(message);
  }],

  // Tasks
  ['GET', '/api/tasks/:id/result', (req, { params }) => {
    const task = must(findTask(params.id));
    return { text: (task.resultPath && readResult(task.resultPath)) || '' };
  }],
  ['POST', '/api/tasks/:id/cancel', (req, { params }) => ({ ok: cancel(must(findTask(params.id))) })],
  ['POST', '/api/tasks/:id/retry', (req, { params }) => ({ ok: retry(must(findTask(params.id))) })],

  // Projects
  ['POST', '/api/projects', (req, { body }) => {
    const cloudId = must(db.clouds.find((c) => c.id === body.cloudId), 'Unknown cloud').id;
    const name = text(body.name, 60);
    if (!name) throw new HttpError(400, 'Name is required');
    return resolveProject(cloudId, name);
  }],
  // Deleting is a sensitive action: the interface asks you to confirm first.
  ['DELETE', '/api/projects/:id', (req, { params }) => {
    const project = must(findProject(params.id));
    const tasks = db.tasks.filter((t) => t.projectId === project.id);
    if (tasks.some((t) => ['queued', 'waiting', 'running'].includes(t.status))) throw new HttpError(409, 'Project has active tasks');
    const sharedPaths = new Set(db.tasks.filter((t) => t.projectId !== project.id).map((t) => t.resultPath));
    for (const t of tasks) if (t.resultPath && !sharedPaths.has(t.resultPath)) removeResult(t.resultPath);
    db.tasks = db.tasks.filter((t) => t.projectId !== project.id);
    db.projects = db.projects.filter((p) => p.id !== project.id);
    save();
    log.info('project.deleted', { project: project.name, tasks: tasks.length });
    emit('project.removed', { id: project.id });
    return { ok: true };
  }],

  // Approvals
  ['POST', '/api/approvals/:id', (req, { params, body }) => {
    const approval = must(db.approvals.find((a) => a.id === params.id));
    if (approval.status !== 'pending') throw new HttpError(409, 'Already decided');
    if (!['approve', 'reject'].includes(body.decision)) throw new HttpError(400, 'decision must be approve or reject');
    return decide(approval, body.decision);
  }],

  // Skills
  ['GET', '/api/skills/:id', (req, { params }) => must(allSkills().find((s) => s.id === params.id))],
  ['DELETE', '/api/skills/:id', (req, { params }) => ({ ok: must(deleteSkill(params.id), 'Only learned skills can be removed') })],

  // Schedules
  ['POST', '/api/schedules', (req, { body }) => {
    const cloudId = must(db.clouds.find((c) => c.id === body.cloudId), 'Unknown cloud').id;
    const worker = WORKERS[body.worker] ? body.worker : db.clouds.find((c) => c.id === cloudId).workers[0];
    const s = addSchedule({ name: text(body.name, 60) || 'Recurring job', cloudId, projectId: resolveProject(cloudId, body.project).id, worker, instruction: text(body.instruction, 2000), every: body.every, at: body.at });
    if (!s) throw new HttpError(400, 'Instruction and a valid frequency are required');
    return s;
  }],
  ['PUT', '/api/schedules/:id', (req, { params, body }) => updateSchedule(must(db.schedules.find((s) => s.id === params.id)), body)],
  ['POST', '/api/schedules/:id/run', (req, { params }) => runSchedule(must(db.schedules.find((s) => s.id === params.id)))],
  ['DELETE', '/api/schedules/:id', (req, { params }) => {
    must(db.schedules.find((s) => s.id === params.id));
    removeSchedule(params.id);
    return { ok: true };
  }],

  // Settings & logs
  ['PUT', '/api/settings', (req, { body }) => {
    const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
    const s = db.settings;
    const raised = Number(body.dailyBudgetUsd) > s.dailyBudgetUsd || Number(body.monthlyBudgetUsd) > s.monthlyBudgetUsd;
    s.dailyBudgetUsd = clamp(body.dailyBudgetUsd, 0, 500, s.dailyBudgetUsd);
    s.monthlyBudgetUsd = clamp(body.monthlyBudgetUsd, 0, 5000, s.monthlyBudgetUsd);
    s.maxParallel = Math.round(clamp(body.maxParallel, 1, 8, s.maxParallel));
    save();
    emit('settings', s);
    emit('spend', spendStatus());
    if (raised) resumeBlocked();
    else pump(); // a higher parallel limit may free slots
    return s;
  }],
  ['GET', '/api/logs', () => log.recent(150)],
];
