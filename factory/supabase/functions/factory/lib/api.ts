// Every action the interface can take, in one list. All require the owner to be signed in,
// except `setup`, which needs the one-time setup code.
import { db, must, getSettings, updateSettings, getSecret, setSecret, deleteSecret, HttpError, log } from './db.ts';
import { modelsForKey } from './ai.ts';
import { handleMessage, resolveProject, createSchedule } from './manager.ts';
import { cancelTask, retryTask, resumePaused, dispatch } from './pool.ts';
import { runSchedule } from './schedules.ts';
import { decide } from './approvals.ts';
import * as google from './google.ts';
import * as obsidian from './obsidian.ts';
import { WORKERS } from './logic.ts';

type Body = Record<string, any>;
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const found = <T>(v: T | null | undefined, what = 'Not found'): T => {
  if (!v) throw new HttpError(404, what);
  return v;
};

const ACTIONS: Record<string, (b: Body) => Promise<unknown>> = {
  // Chat → manager
  chat: (b) => {
    const message = text(b.text, 4000);
    if (!message) throw new HttpError(400, 'Message is empty');
    return handleMessage(message);
  },

  // Tasks
  task_cancel: async (b) => ({ ok: await cancelTask(b.id) }),
  task_retry: async (b) => ({ ok: await retryTask(b.id) }),

  // Projects (deleting is confirmed in the interface first)
  project_create: async (b) => {
    const name = text(b.name, 60);
    if (!name) throw new HttpError(400, 'Name is required');
    return resolveProject(found(must(await db.from('clouds').select('id').eq('id', b.cloudId).maybeSingle()), 'Unknown cloud').id, name);
  },
  project_delete: async (b) => {
    const active = must(await db.from('tasks').select('id').eq('project_id', b.id).in('status', ['queued', 'waiting', 'running']));
    if (active.length) throw new HttpError(409, 'This project has tasks in progress.');
    const project = found(must(await db.from('projects').delete().eq('id', b.id).select().maybeSingle()));
    await log('info', 'project.deleted', { project: project.name });
    return { ok: true };
  },

  // Approvals
  approval_decide: (b) => {
    if (!['approve', 'reject'].includes(b.decision)) throw new HttpError(400, 'decision must be approve or reject');
    return decide(b.id, b.decision);
  },
  youtube_upload_start: async (b) => {
    const a = found(must(await db.from('approvals').select('*').eq('id', b.id).eq('status', 'pending').maybeSingle()));
    if (a.payload?.platform !== 'youtube') throw new HttpError(400, 'Not a YouTube approval');
    if (!(b.size > 0)) throw new HttpError(400, 'Choose a video file');
    return { uploadUrl: await google.youtubeUploadSession(a.payload, { size: b.size, type: text(b.type, 100) }) };
  },
  youtube_upload_done: (b) => decide(b.id, 'approve', { videoId: text(b.videoId, 30) }),

  // Skills
  skill_delete: async (b) => {
    must(await db.from('skills').delete().eq('id', b.id).neq('source', 'builtin'));
    return { ok: true };
  },

  // Schedules
  schedule_create: async (b) => {
    if (!text(b.instruction, 2000) || !['daily', 'weekly', 'hourly'].includes(b.every)) throw new HttpError(400, 'Instruction and a valid frequency are required');
    const clouds = must(await db.from('clouds').select('*'));
    return createSchedule({ name: b.name, cloud: b.cloudId, project: b.project, worker: b.worker, instruction: b.instruction, every: b.every, at: b.at }, clouds);
  },
  schedule_update: async (b) => {
    const changes: Body = {};
    for (const k of ['name', 'instruction', 'at', 'every', 'enabled', 'weekday']) if (k in b) changes[k] = b[k];
    if (changes.at && !/^\d{1,2}:\d{2}$/.test(changes.at)) throw new HttpError(400, 'Time must look like 08:00');
    return must(await db.from('schedules').update(changes).eq('id', b.id).select().single());
  },
  schedule_delete: async (b) => {
    must(await db.from('schedules').delete().eq('id', b.id).eq('kind', 'task'));
    return { ok: true };
  },
  schedule_run: async (b) => {
    const task = await runSchedule(found(must(await db.from('schedules').select('*').eq('id', b.id).maybeSingle())));
    await dispatch();
    return task;
  },

  // Settings
  settings_update: async (b) => {
    const s = await getSettings();
    const changes: Body = {};
    const int = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
    if (b.max_parallel != null) changes.max_parallel = int(b.max_parallel, 1, 6);
    if (b.daily_request_limit != null) changes.daily_request_limit = int(b.daily_request_limit, 1, 2000);
    for (const k of ['verify_results', 'email_briefings']) if (typeof b[k] === 'boolean') changes[k] = b[k];
    if (b.app_url && /^https?:\/\/[^\s]+$/.test(b.app_url)) changes.app_url = text(b.app_url, 200).replace(/[?#].*$/, '');
    if (b.timezone && Intl.supportedValuesOf('timeZone').includes(b.timezone)) changes.timezone = b.timezone;
    const updated = await updateSettings(changes);
    if (changes.timezone && changes.timezone !== s.timezone) {
      // Re-time every schedule in the new time zone.
      for (const sch of must(await db.from('schedules').select('id,every,at,weekday'))) {
        const next = must(await db.rpc('compute_next_run', { p_every: sch.every, p_at: sch.at, p_weekday: sch.weekday, p_tz: changes.timezone }));
        must(await db.from('schedules').update({ next_run: next }).eq('id', sch.id));
      }
    }
    if (changes.daily_request_limit > s.daily_request_limit) await resumePaused();
    else await dispatch(); // a higher parallel limit may free slots
    return updated;
  },

  // Connections
  gemini_key: async (b) => {
    const key = text(b.key, 200);
    const models = await modelsForKey(key);
    await setSecret('gemini_api_key', key);
    await updateSettings({ ai_ready: true, demo: false, models });
    await log('info', 'ai.connected', { models: `${models.standard} / ${models.fast}` });
    await resumePaused();
    return { models };
  },
  gemini_remove: async () => {
    await deleteSecret('gemini_api_key');
    return updateSettings({ ai_ready: false });
  },
  google_client: async (b) => {
    await google.saveClient(text(b.clientId, 200), text(b.clientSecret, 200));
    return { ok: true, redirectUri: google.googleRedirectUri };
  },
  google_auth_url: async () => ({ url: await google.authUrl() }),
  google_disconnect: async () => {
    await google.disconnect();
    return { ok: true };
  },
  google_info: () => Promise.resolve({ redirectUri: google.googleRedirectUri }),
  obsidian_connect: async (b) => {
    await obsidian.connect(text(b.repo, 120), text(b.token, 300), text(b.folder, 60) || 'Factory');
    return { ok: true };
  },
  obsidian_disconnect: async () => {
    await obsidian.disconnect();
    return { ok: true };
  },
};

/** Check the caller is the signed-in owner, then run the action. */
export async function handleAction(req: Request) {
  const body = await req.json().catch(() => {
    throw new HttpError(400, 'Invalid JSON');
  });
  if (body.action === 'setup') return setup(body);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  const { data } = await db.auth.getUser(jwt);
  const settings = await getSettings();
  if (!data?.user?.email || data.user.email !== settings.owner_email) throw new HttpError(401, 'Please sign in.');

  const action = ACTIONS[body.action];
  if (!action) throw new HttpError(404, `Unknown action: ${body.action}`);
  return action(body);
}

/** First run (or forgotten password): choose a password using the one-time setup code. */
async function setup(b: Body) {
  const settings = await getSettings();
  const email = text(b.email, 200).toLowerCase();
  if (email !== settings.owner_email) throw new HttpError(403, 'This factory belongs to a different email address.');
  if (text(b.password, 200).length < 8) throw new HttpError(400, 'Use at least 8 characters for your password.');

  const [hash, expires] = ((await getSecret('setup_code')) ?? '').split('|');
  const given = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text(b.code, 40).toUpperCase())));
  const givenHex = [...given].map((x) => x.toString(16).padStart(2, '0')).join('');
  if (!hash || givenHex !== hash || Date.now() > Date.parse(expires)) throw new HttpError(403, 'That setup code is wrong or has expired.');

  const users = must(await db.auth.admin.listUsers({ perPage: 200 })).users;
  const existing = users.find((u: any) => u.email?.toLowerCase() === email);
  if (existing) must(await db.auth.admin.updateUserById(existing.id, { password: b.password, email_confirm: true }));
  else must(await db.auth.admin.createUser({ email, password: b.password, email_confirm: true }));
  await deleteSecret('setup_code');
  await log('info', 'owner.password_set', {});
  return { ok: true };
}

export const workerNames = () => Object.fromEntries(Object.entries(WORKERS).map(([id, w]) => [id, { name: w.name, tier: w.tier, web: Boolean(w.web) }]));
