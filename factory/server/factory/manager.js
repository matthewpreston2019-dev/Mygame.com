// The manager: turns one chat message into a plan, then hands the tasks to the pool.
//
// One cheap planning call decides: reply directly, or split the request into tasks
// for specialist workers (independent unless one genuinely needs another's result),
// and optionally set up a recurring schedule.
import { db, save, newId, now } from '../core/store.js';
import { config } from '../config.js';
import { emit } from '../http/events.js';
import { log } from '../core/log.js';
import { ask, aiMode } from '../ai/claude.js';
import { WORKERS } from './world.js';
import { createTask } from './tasks.js';
import { enqueue } from './pool.js';
import { addSchedule } from './scheduler.js';

const MAX_TASKS = 6;

export function addChat(role, text, extra = {}) {
  const msg = { id: newId('msg'), role, text, at: now(), ...extra };
  db.chat.push(msg);
  save();
  emit('chat', msg);
  return msg;
}

export async function handleMessage(text) {
  addChat('user', text);

  if (aiMode() === 'offline') {
    return addChat('manager', 'I can\'t start work yet: the server has no ANTHROPIC_API_KEY. Add it to the server\'s environment (see README), or start the factory in demo mode to explore.', { error: true });
  }

  let plan;
  try {
    plan = aiMode() === 'demo' ? demoPlan(text) : (await ask(planRequest(text))).json;
  } catch (err) {
    log.error('manager.plan_failed', { error: err.message });
    return addChat('manager', `I couldn't plan that: ${err.message}`, { error: true });
  }

  const batchId = newId('bat');
  const tasks = createTasks(plan.tasks.slice(0, MAX_TASKS), batchId);
  const schedules = plan.schedules.map((s) => addSchedule(toSchedule(s))).filter(Boolean);

  db.batches.push({ id: batchId, text, taskIds: tasks.map((t) => t.id), createdAt: now() });
  enqueue(tasks);
  if (tasks.length) log.info('manager.planned', { batch: batchId, tasks: tasks.length, parallel: tasks.filter((t) => !t.dependsOn.length).length });

  return addChat('manager', plan.reply, { taskIds: tasks.map((t) => t.id), scheduleIds: schedules.map((s) => s.id), demo: aiMode() === 'demo' });
}

// ── Planning ────────────────────────────────────────────

function planRequest(text) {
  const clouds = db.clouds.map((c) => {
    const projects = db.projects.filter((p) => p.cloudId === c.id).map((p) => p.name).join(' | ');
    return `- ${c.id} (${c.name}: ${c.blurb}) projects: ${projects} · workers: ${c.workers.join(', ')}`;
  });
  const recent = db.chat.slice(-7, -1).map((m) => `${m.role}: ${m.text.slice(0, 300)}`);
  const results = db.tasks.filter((t) => t.status === 'done' && t.summary).slice(-6).map((t) => `- ${t.title}: ${t.summary}`);

  return {
    tier: 'fast',
    maxTokens: 3000,
    schema: planSchema(),
    system: `You are the manager of the owner's AI Worker Factory. You plan; specialist workers do the work.

Areas (clouds):
${clouds.join('\n')}

Workers: ${Object.entries(WORKERS).map(([id, w]) => `${id} (${w.role.split('.')[0]})`).join('; ')}

How to plan:
- If you can answer from the conversation or recent results, reply directly with no tasks.
- Otherwise create the fewest tasks that cover the request (max ${MAX_TASKS}). Each task gets one cloud, one project (existing name, or a short new name when nothing fits), one worker, and a complete self-contained instruction.
- Tasks run in parallel. Use "needs" (indexes of earlier tasks) only when a task truly cannot start without another's result.
- tier: "fast" for simple/routine work, "standard" for most work, "strong" only for complex architecture or deep multi-step analysis.
- skill: a 2–4 word name of the reusable technique if this kind of task will recur (e.g. "game concept pitch"), else "".
- schedules: only when the owner asks for something recurring. every = daily | weekly | hourly; at = "HH:MM" (24h).
- reply: 1–3 friendly sentences saying what you're doing. Never claim work is finished.`,
    prompt: `${recent.length ? `Recent conversation:\n${recent.join('\n')}\n\n` : ''}${results.length ? `Recent results:\n${results.join('\n')}\n\n` : ''}Owner: ${text}`,
  };
}

function planSchema() {
  const cloudIds = db.clouds.map((c) => c.id);
  const workerIds = Object.keys(WORKERS);
  const str = { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'tasks', 'schedules'],
    properties: {
      reply: str,
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'cloud', 'project', 'worker', 'instruction', 'needs', 'tier', 'skill'],
          properties: {
            title: str,
            cloud: { type: 'string', enum: cloudIds },
            project: str,
            worker: { type: 'string', enum: workerIds },
            instruction: str,
            needs: { type: 'array', items: { type: 'integer' } },
            tier: { type: 'string', enum: ['fast', 'standard', 'strong'] },
            skill: str,
          },
        },
      },
      schedules: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'cloud', 'project', 'worker', 'instruction', 'every', 'at'],
          properties: {
            name: str,
            cloud: { type: 'string', enum: cloudIds },
            project: str,
            worker: { type: 'string', enum: workerIds },
            instruction: str,
            every: { type: 'string', enum: ['daily', 'weekly', 'hourly'] },
            at: str,
          },
        },
      },
    },
  };
}

// ── Turning a plan into tasks ───────────────────────────

/** Find a project by name in a cloud, or create it so every task has a clear home. */
export function resolveProject(cloudId, name) {
  const clean = String(name || '').trim().slice(0, 60);
  const inCloud = db.projects.filter((p) => p.cloudId === cloudId);
  const match = inCloud.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (match) return match;
  if (!clean) return inCloud[0];
  const project = { id: newId('prj'), cloudId, name: clean, createdAt: now() };
  db.projects.push(project);
  save();
  emit('project', project);
  return project;
}

const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Identical work finished recently? Reuse it instead of paying for it again. */
function findReusable(cloudId, worker, instruction) {
  const cutoff = Date.now() - config.reuseDays * 86_400_000;
  const key = normalise(instruction);
  return db.tasks.findLast((t) => t.status === 'done' && t.resultPath && !t.scheduleId && t.cloudId === cloudId && t.worker === worker && Date.parse(t.finishedAt) > cutoff && normalise(t.instruction) === key);
}

function createTasks(planned, batchId) {
  const created = [];
  planned.forEach((p, i) => {
    const cloudId = db.clouds.some((c) => c.id === p.cloud) ? p.cloud : 'research';
    const project = resolveProject(cloudId, p.project);
    const base = { batchId, cloudId, projectId: project.id, worker: WORKERS[p.worker] ? p.worker : 'assistant', title: p.title.slice(0, 80), instruction: p.instruction, tier: p.tier, skillHint: p.skill || '' };
    const dependsOn = (p.needs || []).filter((n) => Number.isInteger(n) && n >= 0 && n < i).map((n) => created[n].id);

    const previous = !dependsOn.length && findReusable(base.cloudId, base.worker, base.instruction);
    created.push(
      previous
        ? createTask({ ...base, status: 'done', progress: 100, stage: 'Reused earlier result', reusedFrom: previous.id, resultPath: previous.resultPath, summary: previous.summary, verified: previous.verified, sources: previous.sources, finishedAt: now() })
        : createTask({ ...base, dependsOn }),
    );
  });
  return created;
}

function toSchedule(s) {
  const cloudId = db.clouds.some((c) => c.id === s.cloud) ? s.cloud : 'research';
  return { kind: 'task', name: s.name, cloudId, projectId: resolveProject(cloudId, s.project).id, worker: s.worker, instruction: s.instruction, every: s.every, at: s.at };
}

// ── Demo planner (no API key): simple keyword routing, clearly labelled ──

// Order matters: on a tie, the more specific areas win over Gaming and Research.
const KEYWORDS = {
  content: ['youtube', 'video', 'script', 'thumbnail', 'channel', 'editing', 'tiktok', 'content', 'shorts'],
  finance: ['budget', 'cost', 'costs', 'business', 'analysis', 'price', 'pricing', 'revenue', 'profit', 'finance', 'money', 'market', 'merch'],
  engineering: ['website', 'app', 'code', 'coding', 'api', 'bug', 'react', 'python', 'site', 'software', 'development', 'develop', 'build'],
  automation: ['automate', 'automation', 'schedule', 'organise', 'organize', 'files', 'backup', 'repetitive'],
  assistant: ['remind', 'reminder', 'todo', 'briefing', 'calendar', 'today', 'tomorrow'],
  gaming: ['game', 'games', 'minecraft', 'server', 'player', 'gaming', 'level', 'roblox', 'steam'],
  research: ['research', 'trend', 'trends', 'discover', 'compare', 'study', 'investigate'],
};

export function demoPlan(text) {
  const clauses = text.split(/,|;|\n|\band also\b|\band\b/i).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 2);
  const tasks = [];
  for (const clause of clauses) {
    const words = clause.toLowerCase().match(/[a-z]+/g) || [];
    const ranked = Object.entries(KEYWORDS)
      .map(([cloud, kws]) => [cloud, words.filter((w) => kws.includes(w)).length])
      .sort((a, b) => b[1] - a[1]);
    if (!ranked[0][1]) continue;
    let cloud = ranked[0][0];
    // "game research" → research worker in the Gaming cloud
    if (cloud === 'research' && ranked[1][1]) cloud = ranked[1][0];
    const c = db.clouds.find((x) => x.id === cloud);
    const worker = words.some((w) => KEYWORDS.research.includes(w)) && c.workers.includes('research') ? 'research' : c.workers[0];
    const project = db.projects.find((p) => p.cloudId === cloud)?.name || '';
    tasks.push({ title: clause.charAt(0).toUpperCase() + clause.slice(1, 70), cloud, project, worker, instruction: clause, needs: [], tier: 'standard', skill: '' });
  }
  return {
    reply: tasks.length
      ? `(Demo mode) I've split this into ${tasks.length} task${tasks.length > 1 ? 's' : ''} running in parallel: ${tasks.map((t) => t.title).join('; ')}.`
      : '(Demo mode) I\'m running without an API key, so I can only route work, not answer questions. Try asking for research, a plan or an analysis.',
    tasks: tasks.slice(0, MAX_TASKS),
    schedules: [],
  };
}

