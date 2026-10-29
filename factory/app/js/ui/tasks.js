// Task rows (used in the cloud panel and activity drawer) and the result viewer.
import { h, icon, STATUS, timeAgo, toast } from './dom.js';
import { api, loadResult } from '../api.js';
import { state, cloudById, projectById, LIVE, hasResult } from '../state.js';
import { markdown } from './markdown.js';
import { openModal } from './modal.js';

export function taskRow(task, { showCloud = false } = {}) {
  const s = STATUS[task.status] || STATUS.new;
  const live = LIVE.includes(task.status);
  const done = hasResult(task);
  const worker = state.workers[task.worker]?.name || task.worker;
  const where = showCloud ? `${cloudById(task.cloudId)?.name} › ` : '';
  const meta = `${where}${projectById(task.projectId)?.name || ''} · ${worker}`;

  const actions = h('div', { class: 'task-actions' },
    done ? h('button', { title: 'Open result', onclick: () => openResult(task) }, icon('file')) : null,
    live ? h('button', { title: 'Cancel', onclick: () => act(task, 'task_cancel') }, icon('stop')) : null,
    ['failed', 'cancelled', 'blocked'].includes(task.status) ? h('button', { title: 'Retry', onclick: () => act(task, 'task_retry') }, icon('retry')) : null,
  );

  const stage = !state.connected && live ? `Last known: ${task.stage}` : done && task.summary ? task.summary : task.error && !done ? task.error : task.stage;

  return h('div', { class: `card task${live ? ' live' : ''}${done ? ' clickable' : ''}`, onclick: (e) => !e.target.closest('button') && done && openResult(task) },
    h('div', { class: 'card-row' },
      h('span', { class: `dot ${s.dot}` }),
      h('div', { class: 'task-body' },
        h('div', { class: 'card-title' }, task.title),
        h('div', { class: 'task-stage', title: stage }, stage),
        h('div', { class: 'card-meta faint', style: { fontSize: '11.5px' } }, `${meta} · ${timeAgo(task.finishedAt || task.createdAt)}`),
      ),
      actions,
    ),
    task.status === 'running' ? h('div', { class: 'progress' }, h('i', { style: { width: `${task.progress}%` } })) : null,
  );
}

async function act(task, action) {
  try {
    await api(action, { id: task.id });
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
    task.requests ? h('span', { class: 'chip' }, `${task.requests} AI request${task.requests === 1 ? '' : 's'}`) : null,
    task.notePath ? h('span', { class: 'chip info', title: task.notePath }, 'Saved in Obsidian') : null,
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
    const text = await loadResult(task);
    content.innerHTML = markdown(text || '_No result saved._');
    copy.onclick = () => navigator.clipboard?.writeText(text).then(() => toast('Copied'));
  } catch (err) {
    content.textContent = err.message;
  }
}
