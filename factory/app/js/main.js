// Worker Factory — interface entry point. Wires sign-in, data, live updates, the 3D world, panels and chat.
import { $, hydrateIcons, toast } from './ui/dom.js';
import { sb, api, loadSnapshot, subscribe } from './api.js';
import { state, applySnapshot, applyChange, onChange, changed, allTasks, liveTasks, pendingApprovals, tasksIn, aiMode, schedulerHealthy } from './state.js';
import { createWorld } from './world/scene.js';
import { renderPanel } from './ui/panel.js';
import { initChat, renderChat, updateComposer, toggleLog } from './ui/chat.js';
import { renderDrawers, toggleDrawer, closeDrawers } from './ui/drawers.js';
import { openSettings, renderSettings } from './ui/settings.js';
import { showAuth, hideAuth } from './ui/auth.js';

hydrateIcons();

// ── World ───────────────────────────────────────────────
const world = createWorld($('#world'), { onSelect: focusCloud });

function focusCloud(id) {
  if (id === state.focus) return;
  state.focus = id;
  document.body.classList.toggle('focused', Boolean(id));
  $('#back-btn').classList.toggle('hidden', !id);
  $('#hint').style.opacity = '0';
  if (id) world.focus(id);
  else world.home();
  closeDrawers();
  if (id) toggleLog(false); // give the world and panel the space
  changed('focus');
}

const lastStatus = new Map();

/** Push per-cloud activity and cross-cloud information flow into the 3D world. */
function syncWorld() {
  const info = {};
  for (const cloud of state.clouds) {
    const tasks = tasksIn(cloud.id);
    const workers = {};
    for (const t of tasks) {
      if (t.status === 'running') workers[t.worker] = { status: 'running', title: t.title };
      else if (['queued', 'waiting'].includes(t.status) && !workers[t.worker]) workers[t.worker] = { status: 'waiting' };
    }
    // While disconnected nothing is shown as actively running.
    info[cloud.id] = {
      projects: state.projects.filter((p) => p.cloudId === cloud.id).length,
      running: state.connected ? tasks.filter((t) => t.status === 'running').length : 0,
      queued: tasks.filter((t) => ['queued', 'waiting'].includes(t.status)).length,
      workers: state.connected ? workers : {},
    };
  }

  const dependencies = [];
  for (const t of liveTasks()) {
    for (const depId of t.dependsOn || []) {
      const dep = state.tasks.get(depId);
      if (dep && dep.cloudId !== t.cloudId) dependencies.push({ from: dep.cloudId, to: t.cloudId, key: `${dep.id}>${t.id}` });
    }
  }
  world.update(info, state.workers, state.connected ? dependencies : []);

  // A result was just collected: pulse from its cloud back to the manager.
  for (const t of allTasks()) {
    const before = lastStatus.get(t.id);
    if (before && before !== 'done' && t.status === 'done') world.pulse(t.cloudId);
    lastStatus.set(t.id, t.status);
  }
}

// ── Top bar ─────────────────────────────────────────────
function renderTopbar() {
  if (!state.settings) return;
  const mode = aiMode();
  const [dot, label] = !state.connected
    ? ['bad', 'Offline']
    : mode === 'live' ? ['ok', 'Live'] : mode === 'demo' ? ['warn', 'Demo mode'] : ['bad', 'Add Gemini key'];
  $('#status-pill .dot').className = `dot ${dot}`;
  $('#status-pill .label').textContent = label;
  $('#status-pill').title = schedulerHealthy() ? 'Connected. Background jobs running.' : 'Background jobs have not run recently — schedules may be delayed.';

  const live = liveTasks();
  const running = live.filter((t) => t.status === 'running').length;
  const waiting = live.length - running;
  const parts = [running && `${running} running`, waiting && `${waiting} queued`].filter(Boolean);
  $('#activity-btn .dot').className = `dot ${running && state.connected ? 'info pulse' : waiting ? 'warn' : ''}`;
  $('#activity-btn .label').textContent = parts.length ? `${state.connected ? '' : 'Last known: '}${parts.join(' · ')}` : 'Idle';

  const s = state.settings;
  const used = s.requestsDay === new Date().toISOString().slice(0, 10) ? s.requestsToday : 0;
  $('#usage-pill').textContent = `${used} / ${s.dailyRequestLimit} AI today`;

  const pending = pendingApprovals().length;
  const badge = $('#approvals-btn .badge');
  badge.textContent = pending;
  badge.classList.toggle('hidden', !pending);
}

// ── Reactions to state changes (batched per frame) ──────
onChange((kinds) => {
  if (!state.settings) return;
  if (kinds.has('world')) world.setClouds(state.clouds);
  if (['tasks', 'projects', 'world', 'connection'].some((k) => kinds.has(k))) syncWorld();
  if (['tasks', 'projects', 'skills', 'focus', 'connection'].some((k) => kinds.has(k))) renderPanel();
  if (['chat', 'tasks', 'schedules', 'connection'].some((k) => kinds.has(k))) renderChat();
  if (kinds.has('connection') || kinds.has('settings')) updateComposer();
  renderTopbar();
  renderDrawers();
  renderSettings(kinds);
});

// ── Controls ────────────────────────────────────────────
$('#back-btn').addEventListener('click', () => focusCloud(null));
$('#status-pill').addEventListener('click', () => openSettings(aiMode() === 'live' ? 'general' : 'ai'));
$('#settings-btn').addEventListener('click', () => openSettings('general'));
$('#usage-pill').addEventListener('click', () => openSettings('general'));
$('#activity-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleDrawer('activity'); });
$('#approvals-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleDrawer('approvals'); });

document.addEventListener('click', (e) => {
  if (!e.target.closest('.drawer, dialog')) closeDrawers();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('#modal').open) return;
  if (!$('#activity').classList.contains('hidden') || !$('#approvals').classList.contains('hidden')) closeDrawers();
  else if (state.focus) focusCloud(null);
});

initChat({ focusCloud });

// ── Signing in, loading and staying live ────────────────
let resubscribe = null;

async function load() {
  try {
    applySnapshot(await loadSnapshot());
  } catch (err) {
    if (/no\) rows|0 rows|multiple \(or no\)/i.test(err.message)) {
      toast('This account has no access to the factory.', 'error');
      return sb.auth.signOut();
    }
    toast(`Couldn't load the factory: ${err.message}`, 'error');
    return;
  }
  // Tell the server where the app lives (for Google sign-in) and your time zone (for schedules).
  const appUrl = location.origin + location.pathname;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (state.settings.appUrl !== appUrl || state.settings.timezone !== timezone) api('settings_update', { app_url: appUrl, timezone }).catch(() => {});
}

async function start() {
  hideAuth();
  await load();
  if (!resubscribe) {
    let droppedSinceLoad = false;
    resubscribe = subscribe({
      onChange: applyChange,
      onState(connected) {
        if (connected && droppedSinceLoad) load(); // reconnected: catch up on anything missed
        droppedSinceLoad = !connected && state.connected ? true : connected ? false : droppedSinceLoad;
        state.connected = connected;
        document.body.classList.toggle('disconnected', !connected);
        changed('connection');
      },
    });
  } else resubscribe();
  afterGoogleRedirect();
}

function afterGoogleRedirect() {
  const result = new URLSearchParams(location.search).get('google');
  if (!result) return;
  history.replaceState(null, '', location.pathname);
  const messages = { connected: ['Google connected', ''], cancelled: ['Google connection cancelled', 'error'], expired: ['That Google link expired. Try again.', 'error'], failed: ["Google didn't give access. Check the steps and try again.", 'error'] };
  const [text, kind] = messages[result] ?? messages.failed;
  toast(text, kind);
  openSettings('connections');
}

sb.auth.onAuthStateChange((event, session) => {
  if (session?.user && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && state.user?.id !== session.user.id) {
    state.user = session.user;
    start();
  } else if (!session) {
    state.user = null;
    state.connected = false;
    document.body.classList.add('disconnected');
    showAuth();
  }
});
