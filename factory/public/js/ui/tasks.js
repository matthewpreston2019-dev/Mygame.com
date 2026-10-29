// Task rows (used in the cloud panel and activity drawer) and the result viewer.
import { h, icon, STATUS, timeAgo, money, toast } from './dom.js';
import { api } from '../api.js';
import { state, cloudById, projectById, LIVE } from '../state.js';
import { markdown } from './markdown.js';
import { openModal } from './modal.js';

export function taskRow(task, { showCloud = false } = {}) {
  const s = STATUS[task.status] || STATUS.new;
  const live = LIVE.includes(task.status);
  const worker = state.workers[task.worker]?.name || task.worker;
  const where = showCloud ? `${cloudById(task.cloudId)?.name} › ` : '';
  const meta = `${where}${projectById(task.projectId)?.name || ''} · ${worker}`;

  const actions = h('div', { class: 'task-actions' },
    task.resultPath ? h('button', { title: 'Open result', onclick: () => openResult(task) }, icon('file')) : null,
    live ? h('button', { title: 'Cancel', onclick: () => act(task, 'cancel') }, icon('stop')) : null,
    ['failed', 'cancelled', 'blocked'].includes(task.status) ? h('button', { title: 'Retry', onclick: () => act(task, 'retry') }, icon('retry')) : null,
  );

  const stage = !state.connected && live ? `Last known: ${task.stage}` : task.status === 'done' && task.summary ? task.summary : task.error && task.status !== 'done' ? task.error : task.stage;

  return h('div', { class: `card task${live ? ' live' : ''}${task.resultPath ? ' clickable' : ''}`, onclick: (e) => !e.target.closest('button') && task.resultPath && openResult(task) },
    h('div', { class: 'card-row' },
      h('span', { class: `dot ${s.dot}` }),
      h('div', { class: 'task-body' },
        h('div', { class: 'card-title' }, task.title),
        h('div', { class: 'task-stage', title: stage }, stage),
        h('div', { class: 'card-meta faint', style: { fontSize: '11.5px' } }, `${meta} · ${task.finishedAt ? timeAgo(task.finishedAt) : timeAgo(task.createdAt)}`),
      ),
      actions,
    ),
    task.status === 'running' ? h('div', { class: 'progress' }, h('i', { style: { width: `${task.progress}%` } })) : null,
  );
}

async function act(task, action) {
  try {
    await api(`/api/tasks/${task.id}/${action}`, { method: 'POST' });
  } catch (err) {
    toast(err.message, 'error');
  }
}

export async function openResult(task) {
  const cloud = cloudById(task.cloudId);
  const chips = h('div', { class: 'chips', style: { marginTop: 0, marginBottom: '14px' } },
    h('span', { class: 'chip' }, state.workers[task.worker]?.name || task.worker),
    task.verified === true ? h('span', { class: 'chip ok' }, '✓ Verified') : task.verified === false ? h('span', { class: 'chip warn' }, 'Needs review') : h('span', { class: 'chip' }, 'Not checked'),
    task.reusedFrom ? h('span', { class: 'chip info' }, 'Reused earlier result') : null,
    task.model ? h('span', { class: 'chip' }, task.model) : null,
    task.costUsd ? h('span', { class: 'chip' }, money(task.costUsd)) : null,
    ...(task.skillIds || []).map((s) => h('span', { class: 'chip info' }, `skill: ${s}`)),
  );
  const content = h('div', { class: 'prose' }, h('p', { class: 'muted' }, 'Loading…'));
  const copy = h('button', { class: 'btn small' }, icon('copy'), 'Copy');
  openModal({
    title: task.title,
    subtitle: `${cloud?.name} › ${projectById(task.projectId)?.name || 'Inbox'}`,
    body: h('div', {}, chips, content, h('div', { class: 'row-actions' }, copy)),
  });
  try {
    const { text } = await api(`/api/tasks/${task.id}/result`);
    content.innerHTML = markdown(text || '_No result saved._');
    copy.onclick = () => navigator.clipboard?.writeText(text).then(() => toast('Copied'));
  } catch (err) {
    content.textContent = err.message;
  }
}
