// The manager: turns one chat message into a plan, then hands the tasks to the pool.
//
// One quick planning call decides: reply directly, or split the request into tasks for
// specialist workers (independent unless one genuinely needs another's result), and
// optionally set up a recurring schedule.
import { db, must, now, addChat, getSettings, log } from './db.ts';
import { ask, aiMode } from './ai.ts';
import { WORKERS, demoPlan, normalise } from './logic.ts';
import { dispatch } from './pool.ts';

const MAX_TASKS = 6;
const REUSE_DAYS = 7;

export async function handleMessage(text: string) {
  await addChat('user', text);
  const settings = await getSettings();
  const mode = aiMode(settings);
  if (mode === 'offline') {
    return addChat('manager', "I can't start work yet: add your free Gemini key in Settings → AI (takes a minute), then ask again.", { error: true });
  }

  const [clouds, projects] = await Promise.all([must(await db.from('clouds').select('*').order('sort')), must(await db.from('projects').select('*'))]);

  let plan: any;
  try {
    plan = mode === 'demo' ? demoPlan(text, clouds, projects) : (await ask(await planRequest(text, clouds, projects))).json;
  } catch (err) {
    await log('error', 'manager.plan_failed', { error: (err as Error).message });
    return addChat('manager', `I couldn't plan that: ${(err as Error).message}`, { error: true });
  }

  const batchId = crypto.randomUUID();
  const tasks = await createTasks((plan.tasks ?? []).slice(0, MAX_TASKS), batchId, clouds);
  const schedules = [];
  for (const s of plan.schedules ?? []) schedules.push(await createSchedule(s, clouds));
  if (tasks.length) await log('info', 'manager.planned', { tasks: tasks.length, parallel: tasks.filter((t) => !t.depends_on.length).length });

  const reply = await addChat('manager', plan.reply || 'On it.', { task_ids: tasks.map((t) => t.id), schedule_ids: schedules.map((s) => s.id), demo: mode === 'demo' });
  await dispatch();
  return reply;
}

async function planRequest(text: string, clouds: any[], projects: any[]) {
  const areas = clouds.map((c) => `- ${c.id} (${c.name}: ${c.blurb}) projects: ${projects.filter((p) => p.cloud_id === c.id).map((p) => p.name).join(' | ')} · workers: ${c.workers.join(', ')}`);
  const recent = must(await db.from('chat').select('role,text').order('created_at', { ascending: false }).range(1, 6)).reverse();
  const results = must(await db.from('tasks').select('title,summary').eq('status', 'done').neq('summary', '').order('finished_at', { ascending: false }).limit(6));

  return {
    tier: 'fast',
    maxTokens: 4096,
    schema: planSchema(clouds),
    system: `You are the manager of the owner's AI Worker Factory. You plan; specialist workers do the work.

Areas (clouds):
${areas.join('\n')}

Workers: ${Object.entries(WORKERS).map(([id, w]) => `${id} (${w.role.split('.')[0]})`).join('; ')}

How to plan:
- If you can answer from the conversation or recent results, reply directly with no tasks.
- Otherwise create the fewest tasks that cover the request (max ${MAX_TASKS}); the owner's AI allowance is small. Each task gets one cloud, one project (existing name, or a short new name when nothing fits), one worker, and a complete self-contained instruction.
- Tasks run in parallel. Use "needs" (indexes of earlier tasks) only when a task truly cannot start without another's result.
- tier: "fast" for simple/routine work, "standard" for most work, "strong" only for complex analysis.
- skill: a 2–4 word name of the reusable technique if this kind of task will recur (e.g. "game concept pitch"), else "".
- Emails and YouTube uploads: workers prepare them; the owner approves before anything is sent or uploaded.
- schedules: only when the owner asks for something recurring. every = daily | weekly | hourly; at = "HH:MM" (24h).
- reply: 1–3 friendly sentences saying what you're doing. Never claim work is finished.`,
    prompt: `${recent.length ? `Recent conversation:\n${recent.map((m: any) => `${m.role}: ${m.text.slice(0, 300)}`).join('\n')}\n\n` : ''}${results.length ? `Recent results:\n${results.map((t: any) => `- ${t.title}: ${t.summary}`).join('\n')}\n\n` : ''}Owner: ${text}`,
  };
}

function planSchema(clouds: any[]) {
  const str = { type: 'string' };
  const cloud = { type: 'string', enum: clouds.map((c) => c.id) };
  const worker = { type: 'string', enum: Object.keys(WORKERS) };
  return {
    type: 'object',
    properties: {
      reply: str,
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: { title: str, cloud, project: str, worker, instruction: str, needs: { type: 'array', items: { type: 'integer' } }, tier: { type: 'string', enum: ['fast', 'standard', 'strong'] }, skill: str },
          required: ['title', 'cloud', 'project', 'worker', 'instruction', 'needs', 'tier', 'skill'],
        },
      },
      schedules: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: str, cloud, project: str, worker, instruction: str, every: { type: 'string', enum: ['daily', 'weekly', 'hourly'] }, at: str },
          required: ['name', 'cloud', 'project', 'worker', 'instruction', 'every', 'at'],
        },
      },
    },
    required: ['reply', 'tasks', 'schedules'],
  };
}

/** Find a project by name in a cloud, or create it, so every task has a clear home. */
export async function resolveProject(cloudId: string, name: string) {
  const clean = String(name || '').trim().slice(0, 60);
  const inCloud = must(await db.from('projects').select('*').eq('cloud_id', cloudId).order('created_at'));
  const match = inCloud.find((p: any) => p.name.toLowerCase() === clean.toLowerCase());
  if (match) return match;
  if (!clean) return inCloud[0];
  return must(await db.from('projects').insert({ cloud_id: cloudId, name: clean }).select().single());
}

async function createTasks(planned: any[], batchId: string, clouds: any[]) {
  const created: any[] = [];
  const since = new Date(Date.now() - REUSE_DAYS * 86_400_000).toISOString();
  for (const [i, p] of planned.entries()) {
    const cloud = clouds.find((c) => c.id === p.cloud) ?? clouds.find((c) => c.id === 'research');
    const project = await resolveProject(cloud.id, p.project);
    const worker = WORKERS[p.worker] ? p.worker : cloud.workers[0];
    const dependsOn = (p.needs ?? []).filter((n: number) => Number.isInteger(n) && n >= 0 && n < i).map((n: number) => created[n].id);
    const base = { batch_id: batchId, cloud_id: cloud.id, project_id: project.id, worker, title: String(p.title).slice(0, 80), instruction: p.instruction, tier: p.tier || 'standard', skill_hint: p.skill || '', depends_on: dependsOn };

    // Identical work finished recently? Reuse it instead of spending free requests again.
    const previous = dependsOn.length
      ? null
      : must(await db.from('tasks').select('id,instruction,summary,verified,sources,reused_from').eq('status', 'done').eq('cloud_id', cloud.id).eq('worker', worker).is('schedule_id', null).gt('finished_at', since).order('finished_at', { ascending: false }).limit(50))
          .find((t: any) => normalise(t.instruction) === normalise(p.instruction));

    created.push(
      must(
        await db
          .from('tasks')
          .insert(
            (previous
              ? { ...base, status: 'done', progress: 100, stage: 'Reused earlier result', reused_from: previous.reused_from ?? previous.id, summary: previous.summary, verified: previous.verified, sources: previous.sources, finished_at: now() }
              : base) as Record<string, unknown>,
          )
          .select()
          .single(),
      ),
    );
  }
  return created;
}

export async function createSchedule(s: any, clouds: any[]) {
  const cloud = clouds.find((c) => c.id === s.cloud) ?? clouds.find((c) => c.id === 'research');
  const project = await resolveProject(cloud.id, s.project);
  const at = /^\d{1,2}:\d{2}$/.test(s.at) ? s.at : '09:00';
  return must(
    await db
      .from('schedules')
      .insert({ kind: 'task', name: String(s.name || 'Recurring job').slice(0, 60), cloud_id: cloud.id, project_id: project.id, worker: WORKERS[s.worker] ? s.worker : cloud.workers[0], instruction: String(s.instruction).slice(0, 2000), every: s.every, at })
      .select()
      .single(),
  );
}
