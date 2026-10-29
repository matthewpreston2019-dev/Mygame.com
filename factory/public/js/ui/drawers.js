// Top-right drawers: live activity (all running work) and approvals (sensitive actions).
import { h, fill, icon, toast, timeAgo } from './dom.js';
import { api } from '../api.js';
import { state, allTasks, liveTasks, pendingApprovals, cloudById } from '../state.js';
import { taskRow } from './tasks.js';

const drawers = ['activity', 'approvals'];

export function toggleDrawer(name) {
  for (const d of drawers) document.getElementById(d).classList.toggle('hidden', d !== name || !document.getElementById(d).classList.contains('hidden'));
  renderDrawers();
}

export function closeDrawers() {
  for (const d of drawers) document.getElementById(d).classList.add('hidden');
}

export function renderDrawers() {
  const activity = document.getElementById('activity');
  if (!activity.classList.contains('hidden')) {
    const live = liveTasks();
    const recent = allTasks().filter((t) => ['done', 'failed'].includes(t.status)).sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt)).slice(0, 6);
    const busy = live.filter((t) => t.status === 'running').length;
    fill(activity,
      h('h3', {}, 'Live tasks', h('span', { class: 'muted', style: { fontWeight: 400, fontSize: '12px' } }, `${busy} / ${state.settings.maxParallel} workers busy`)),
      !state.connected ? h('p', { class: 'chip bad', style: { margin: '0 0 10px' } }, 'Backend offline — showing last known state') : null,
      live.length ? live.map((t) => taskRow(t, { showCloud: true })) : h('div', { class: 'empty' }, 'Nothing running.'),
      recent.length ? [h('div', { class: 'section-title' }, 'Recently finished'), recent.map((t) => taskRow(t, { showCloud: true }))] : null,
    );
  }

  const approvals = document.getElementById('approvals');
  if (!approvals.classList.contains('hidden')) {
    const pending = pendingApprovals();
    const decided = [...state.approvals.values()].filter((a) => a.status !== 'pending').slice(-8).reverse();
    fill(approvals,
      h('h3', {}, 'Approvals'),
      h('p', { class: 'muted', style: { margin: '-6px 4px 12px', fontSize: '12.5px' } }, 'Workers never send, publish, spend or delete on their own. They prepare the action and wait for you.'),
      pending.length ? pending.map(approvalCard) : h('div', { class: 'empty' }, 'Nothing needs your approval.'),
      decided.length ? [h('div', { class: 'section-title' }, 'Decided'), decided.map(approvalCard)] : null,
    );
  }
}

const KIND_LABEL = { message: 'Send message', publish: 'Publish', spend: 'Spend money', delete: 'Delete', other: 'Action' };

function approvalCard(a) {
  const task = state.tasks.get(a.taskId);
  const decide = async (decision) => {
    try {
      await api(`/api/approvals/${a.id}`, { method: 'POST', body: { decision } });
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card-row' },
      h('span', { class: `chip ${a.status === 'pending' ? 'warn' : a.status === 'approved' ? 'ok' : ''}` }, KIND_LABEL[a.kind] || a.kind),
      h('span', { class: 'faint', style: { marginLeft: 'auto', fontSize: '12px' } }, timeAgo(a.createdAt)),
    ),
    h('div', { style: { marginTop: '8px', fontWeight: 550 } }, a.summary),
    h('div', { class: 'card-meta' }, `${cloudById(a.cloudId)?.name || ''}${task ? ` · from “${task.title}”` : ''}`),
    a.details ? h('div', { class: 'approval-details' }, a.details) : null,
    a.status === 'pending'
      ? h('div', { class: 'approval-actions' },
          h('button', { class: 'btn small primary', onclick: () => decide('approve') }, icon('check'), 'Approve'),
          h('button', { class: 'btn small', onclick: () => decide('reject') }, 'Reject'),
        )
      : h('div', { class: 'card-meta' }, a.note),
  );
}
