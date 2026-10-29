// The interface's copy of the factory, kept current by live updates.
// Rows arrive from the database in snake_case and are stored in camelCase.
// UI modules subscribe with onChange(); updates are batched into one render per frame.

export const state = {
  user: null,
  connected: false,
  settings: null,
  clouds: [],
  projects: [],
  workers: {},
  tasks: new Map(),
  approvals: new Map(),
  schedules: new Map(),
  skills: [],
  chat: [],
  focus: null, // id of the cloud being viewed
};

const listeners = new Set();
let pending = new Set();
let scheduled = false;

export function onChange(fn) {
  listeners.add(fn);
}

/** Mark something as changed: 'tasks', 'chat', 'focus', 'connection', … */
export function changed(kind) {
  pending.add(kind);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    const kinds = pending;
    pending = new Set();
    scheduled = false;
    for (const fn of listeners) fn(kinds);
  });
}

const camelKey = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export const camel = (row) => (row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [camelKey(k), v])) : row);

/** Tasks keep their (possibly long) result out of memory; it is loaded when opened. */
function taskRow(row) {
  const t = camel(row);
  delete t.result;
  return t;
}

const byId = (list, map = camel) => new Map(list.map((x) => [x.id, map(x)]));

export function applySnapshot(s) {
  Object.assign(state, {
    settings: camel(s.settings),
    clouds: s.clouds.map(camel),
    projects: s.projects.map(camel),
    workers: s.workers,
    tasks: byId(s.tasks, taskRow),
    approvals: byId(s.approvals),
    schedules: byId(s.schedules),
    skills: s.skills.map(camel),
    chat: s.chat.map(camel),
  });
  ['tasks', 'chat', 'approvals', 'schedules', 'skills', 'projects', 'settings', 'world'].forEach(changed);
}

/** One live database change. */
export function applyChange(table, type, row, old) {
  const gone = type === 'DELETE';
  const id = (gone ? old : row).id;
  switch (table) {
    case 'tasks':
      gone ? state.tasks.delete(id) : state.tasks.set(id, taskRow(row));
      break;
    case 'approvals':
      gone ? state.approvals.delete(id) : state.approvals.set(id, camel(row));
      break;
    case 'schedules':
      gone ? state.schedules.delete(id) : state.schedules.set(id, camel(row));
      break;
    case 'chat':
      if (!gone && !state.chat.some((m) => m.id === id)) state.chat.push(camel(row));
      break;
    case 'projects':
      state.projects = state.projects.filter((p) => p.id !== id);
      if (!gone) state.projects.push(camel(row));
      else for (const [tid, t] of state.tasks) if (t.projectId === id) state.tasks.delete(tid);
      changed('tasks');
      break;
    case 'skills': {
      state.skills = state.skills.filter((s) => s.id !== id);
      if (!gone) {
        const { body, ...summary } = camel(row);
        state.skills.push(summary);
      }
      break;
    }
    case 'settings':
      state.settings = camel(row);
      break;
  }
  changed(table);
}

// ── Selectors ───────────────────────────────────────────

export const LIVE = ['queued', 'waiting', 'running', 'blocked'];
export const allTasks = () => [...state.tasks.values()];
export const cloudById = (id) => state.clouds.find((c) => c.id === id);
export const projectById = (id) => state.projects.find((p) => p.id === id);
export const tasksIn = (cloudId) => allTasks().filter((t) => t.cloudId === cloudId);
export const liveTasks = () => allTasks().filter((t) => LIVE.includes(t.status));
export const pendingApprovals = () => [...state.approvals.values()].filter((a) => a.status === 'pending');
export const hasResult = (t) => t.status === 'done';

/** 'live', 'demo' or 'offline' (no Gemini key yet). */
export const aiMode = () => (state.settings?.aiReady ? 'live' : state.settings?.demo ? 'demo' : 'offline');

/** The scheduler runs every 5 minutes; if it hasn't for 15, background work isn't happening. */
export const schedulerHealthy = () => Boolean(state.settings?.lastTickAt) && Date.now() - Date.parse(state.settings.lastTickAt) < 15 * 60_000;
