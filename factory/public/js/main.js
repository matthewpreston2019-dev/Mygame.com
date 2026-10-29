// Worker Factory — interface entry point. Wires the 3D world, panels, chat and live connection.
import { $, hydrateIcons, money } from './ui/dom.js';
import { connect } from './api.js';
import { state, applyEvent, onChange, changed, allTasks, liveTasks, pendingApprovals, tasksIn } from './state.js';
import { createWorld } from './world/scene.js';
import { renderPanel } from './ui/panel.js';
import { initChat, renderChat, updateComposer, toggleLog } from './ui/chat.js';
import { renderDrawers, toggleDrawer, closeDrawers } from './ui/drawers.js';
import { initSettings, openSettings, renderSettings } from './ui/settings.js';

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
    const running = state.connected ? tasks.filter((t) => t.status === 'running').length : 0;
    info[cloud.id] = {
      projects: state.projects.filter((p) => p.cloudId === cloud.id).length,
      running,
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
  const ai = state.status?.ai;
  const [dot, label] = !state.connected
    ? ['bad', 'Offline']
    : ai === 'live' ? ['ok', 'Live'] : ai === 'demo' ? ['warn', 'Demo mode'] : ['bad', 'No API key'];
  $('#status-pill .dot').className = `dot ${dot}`;
  $('#status-pill .label').textContent = label;

  const live = liveTasks();
  const running = live.filter((t) => t.status === 'running').length;
  const waiting = live.length - running;
  const parts = [running && `${running} running`, waiting && `${waiting} queued`].filter(Boolean);
  $('#activity-btn .dot').className = `dot ${running && state.connected ? 'info pulse' : waiting ? 'warn' : ''}`;
  $('#activity-btn .label').textContent = parts.length ? `${state.connected ? '' : 'Last known: '}${parts.join(' · ')}` : 'Idle';

  const spend = state.status?.spend;
  $('#spend-pill').textContent = spend ? `${money(spend.dayUsd)} / $${spend.dailyBudgetUsd} today` : '';

  const pending = pendingApprovals().length;
  const badge = $('#approvals-btn .badge');
  badge.textContent = pending;
  badge.classList.toggle('hidden', !pending);
}

// ── Reactions to state changes (batched per frame) ──────
onChange((kinds) => {
  if (kinds.has('world')) world.setClouds(state.clouds);
  if (['tasks', 'projects', 'world', 'connection'].some((k) => kinds.has(k))) syncWorld();
  if (['tasks', 'projects', 'skills', 'focus', 'connection'].some((k) => kinds.has(k))) renderPanel();
  if (['chat', 'tasks', 'schedules', 'connection'].some((k) => kinds.has(k))) renderChat();
  if (kinds.has('connection') || kinds.has('status')) updateComposer();
  renderTopbar();
  renderDrawers();
  renderSettings(kinds);
});

// ── Controls ────────────────────────────────────────────
$('#back-btn').addEventListener('click', () => focusCloud(null));
$('#status-pill').addEventListener('click', () => openSettings('general'));
$('#settings-btn').addEventListener('click', () => openSettings('general'));
$('#spend-pill').addEventListener('click', () => openSettings('general'));
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

// ── Live connection ─────────────────────────────────────
const connection = connect({
  onEvent: applyEvent,
  onState(connected) {
    state.connected = connected;
    document.body.classList.toggle('disconnected', !connected);
    changed('connection');
  },
  onAuth: () => openSettings('general'),
});
initSettings({ reconnect: connection.reconnect });
