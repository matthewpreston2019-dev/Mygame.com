// The interface's copy of the factory, kept current by server events.
// UI modules subscribe with onChange(); updates are batched into one render per frame.

export const state = {
  connected: false,
  status: null, // { ai, models, spend, … }
  clouds: [],
  projects: [],
  workers: {},
  tasks: new Map(),
  approvals: new Map(),
  schedules: new Map(),
  skills: [],
  chat: [],
  settings: {},
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

const byId = (list) => new Map(list.map((x) => [x.id, x]));

export function applyEvent(type, data) {
  switch (type) {
    case 'snapshot':
      Object.assign(state, {
        status: data.status,
        clouds: data.clouds,
        projects: data.projects,
        workers: data.workers,
        tasks: byId(data.tasks),
        approvals: byId(data.approvals),
        schedules: byId(data.schedules),
        skills: data.skills,
        chat: data.chat,
        settings: data.settings,
      });
      return ['tasks', 'chat', 'approvals', 'schedules', 'skills', 'projects', 'status', 'world'].forEach(changed);
    case 'task':
      state.tasks.set(data.id, data);
      return changed('tasks');
    case 'chat':
      if (!state.chat.some((m) => m.id === data.id)) state.chat.push(data);
      return changed('chat');
    case 'approval':
      state.approvals.set(data.id, data);
      return changed('approvals');
    case 'schedule':
      state.schedules.set(data.id, data);
      return changed('schedules');
    case 'schedule.removed':
      state.schedules.delete(data.id);
      return changed('schedules');
    case 'project':
      if (!state.projects.some((p) => p.id === data.id)) state.projects.push(data);
      return changed('projects');
    case 'project.removed':
      state.projects = state.projects.filter((p) => p.id !== data.id);
      for (const [id, t] of state.tasks) if (t.projectId === data.id) state.tasks.delete(id);
      changed('tasks');
      return changed('projects');
    case 'skills':
      state.skills = data;
      return changed('skills');
    case 'settings':
      state.settings = data;
      return changed('status');
    case 'spend':
      if (state.status) state.status.spend = data;
      return changed('status');
  }
}

// ── Selectors ───────────────────────────────────────────

export const LIVE = ['queued', 'waiting', 'running', 'blocked'];
export const allTasks = () => [...state.tasks.values()];
export const cloudById = (id) => state.clouds.find((c) => c.id === id);
export const projectById = (id) => state.projects.find((p) => p.id === id);
export const tasksIn = (cloudId) => allTasks().filter((t) => t.cloudId === cloudId);
export const liveTasks = () => allTasks().filter((t) => LIVE.includes(t.status));
export const pendingApprovals = () => [...state.approvals.values()].filter((a) => a.status === 'pending');
