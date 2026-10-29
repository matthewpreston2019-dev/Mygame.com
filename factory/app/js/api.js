// Talking to the factory's backend (Supabase):
//   read   tables directly (the database only lets the signed-in owner read)
//   live   one Realtime channel pushes every change, so nothing polls
//   write  every action goes through the `factory` server function, which checks it
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/factory`;

/** Run a server action, e.g. api('chat', { text }). Throws with a readable message on failure. */
export async function api(action, body = {}) {
  const { data } = await sb.auth.getSession();
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      ...(data.session && { Authorization: `Bearer ${data.session.access_token}` }),
    },
    body: JSON.stringify({ action, ...body }),
  }).catch(() => {
    throw new Error('Could not reach the factory. Check your connection.');
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// ── Reading ─────────────────────────────────────────────

const TASK_COLUMNS = 'id,batch_id,schedule_id,cloud_id,project_id,worker,title,instruction,tier,depends_on,status,progress,stage,attempts,error,summary,verified,issues,reused_from,skill_ids,sources,model,requests,note_path,created_at,started_at,finished_at';

const rows = async (query) => {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};

/** Everything the interface needs on load. Old finished tasks are left out to keep it light. */
export async function loadSnapshot() {
  const [clouds, projects, tasks, chat, approvals, schedules, skills, settings, workers] = await Promise.all([
    rows(sb.from('clouds').select('*').order('sort')),
    rows(sb.from('projects').select('*').order('created_at')),
    rows(sb.from('tasks').select(TASK_COLUMNS).order('created_at', { ascending: false }).limit(300)),
    rows(sb.from('chat').select('*').order('created_at', { ascending: false }).limit(80)),
    rows(sb.from('approvals').select('*').order('created_at', { ascending: false }).limit(60)),
    rows(sb.from('schedules').select('*').order('created_at')),
    rows(sb.from('skills').select('id,name,description,tags,workers,source,origin,created_at').order('name')),
    rows(sb.from('settings').select('*').eq('id', 1).single()),
    fetch(`${FUNCTION_URL}/workers`).then((r) => r.json()),
  ]);
  return { clouds, projects, tasks: tasks.reverse(), chat: chat.reverse(), approvals: approvals.reverse(), schedules, skills, settings, workers };
}

/** The full result of a finished task (a reused task points at the original). */
export async function loadResult(task) {
  const { data, error } = await sb.from('tasks').select('result').eq('id', task.reusedFrom || task.id).single();
  if (error) throw new Error(error.message);
  return data.result || '';
}

export const loadSkill = (id) => rows(sb.from('skills').select('*').eq('id', id).single());
export const loadLogs = () => rows(sb.from('logs').select('*').order('at', { ascending: false }).limit(150));

// ── Live updates ────────────────────────────────────────

const LIVE_TABLES = ['tasks', 'chat', 'approvals', 'schedules', 'projects', 'skills', 'settings'];

/**
 * Subscribe to every change. onChange(table, eventType, row, oldRow) for each change;
 * onState(true/false) as the live connection opens or drops. Returns a function to resubscribe.
 */
export function subscribe({ onChange, onState }) {
  let channel = null;
  const open = () => {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('factory');
    for (const table of LIVE_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => onChange(table, p.eventType, p.new, p.old));
    }
    channel.subscribe((status) => onState(status === 'SUBSCRIBED'));
  };
  open();
  // Phones suspend background tabs: reconnect as soon as the page is visible again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && channel?.state !== 'joined') open();
  });
  window.addEventListener('online', open);
  return open;
}
