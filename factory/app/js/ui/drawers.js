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
      h('h3', {}, 'Live tasks', h('span', { class: 'muted', style: { fontWeight: 400, fontSize: '12px' } }, `${busy} / ${state.settings?.maxParallel ?? '–'} workers busy`)),
      !state.connected ? h('p', { class: 'chip bad', style: { margin: '0 0 10px' } }, 'Offline — showing last known state') : null,
      live.length ? live.map((t) => taskRow(t, { showCloud: true })) : h('div', { class: 'empty' }, 'Nothing running.'),
      recent.length ? [h('div', { class: 'section-title' }, 'Recently finished'), recent.map((t) => taskRow(t, { showCloud: true }))] : null,
    );
  }

  const approvals = document.getElementById('approvals');
  if (!approvals.classList.contains('hidden') && !approvals.querySelector('.uploading')) {
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

const KIND_LABEL = { message: 'Email', publish: 'Publish', spend: 'Spend money', delete: 'Delete', other: 'Action' };

function approvalCard(a) {
  const task = state.tasks.get(a.taskId);
  const google = state.settings?.google?.connected;
  const isEmail = a.kind === 'message' && a.payload?.to;
  const isYouTube = a.kind === 'publish' && a.payload?.platform === 'youtube';

  const decide = async (decision, button) => {
    button.disabled = true;
    try {
      await api('approval_decide', { id: a.id, decision });
      toast(decision === 'approve' ? (isEmail ? 'Email sent' : 'Approved') : 'Rejected');
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  };

  let actions;
  if (a.status !== 'pending') actions = h('div', { class: 'card-meta' }, a.note);
  else if ((isEmail || isYouTube) && !google) {
    actions = h('div', { class: 'approval-actions' },
      h('span', { class: 'card-meta', style: { flex: 1 } }, 'Connect Google in Settings → Connections to do this from here.'),
      h('button', { class: 'btn small', onclick: (e) => decide('reject', e.currentTarget) }, 'Reject'),
    );
  } else if (isYouTube) {
    actions = youtubeUpload(a);
  } else {
    actions = h('div', { class: 'approval-actions' },
      h('button', { class: 'btn small primary', onclick: (e) => decide('approve', e.currentTarget) }, icon('check'), isEmail ? 'Send email' : 'Approve'),
      h('button', { class: 'btn small', onclick: (e) => decide('reject', e.currentTarget) }, 'Reject'),
    );
  }

  return h('div', { class: 'card' },
    h('div', { class: 'card-row' },
      h('span', { class: `chip ${a.status === 'pending' ? 'warn' : a.status === 'approved' ? 'ok' : ''}` }, isYouTube ? 'YouTube' : KIND_LABEL[a.kind] || a.kind),
      h('span', { class: 'faint', style: { marginLeft: 'auto', fontSize: '12px' } }, timeAgo(a.createdAt)),
    ),
    h('div', { style: { marginTop: '8px', fontWeight: 550 } }, a.summary),
    h('div', { class: 'card-meta' }, `${cloudById(a.cloudId)?.name || ''}${task ? ` · from “${task.title}”` : ''}`),
    a.details ? h('div', { class: 'approval-details' }, a.details) : null,
    actions,
  );
}

/** Pick a video, then the browser uploads it straight to YouTube (as private). */
function youtubeUpload(a) {
  const input = h('input', { type: 'file', accept: 'video/*', style: { display: 'none' } });
  const bar = h('i', { style: { width: '0%' } });
  const status = h('span', { class: 'card-meta', style: { flex: 1 } }, 'Uploads as private. You publish it in YouTube Studio.');
  const box = h('div', {},
    h('div', { class: 'approval-actions' },
      status,
      h('button', { class: 'btn small primary', onclick: () => input.click() }, icon('play'), 'Choose video & upload'),
      h('button', { class: 'btn small', onclick: () => api('approval_decide', { id: a.id, decision: 'reject' }).catch((e) => toast(e.message, 'error')) }, 'Reject'),
    ),
    h('div', { class: 'progress hidden' }, bar),
    input,
  );

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    box.classList.add('uploading');
    box.querySelector('.progress').classList.remove('hidden');
    box.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      status.textContent = 'Starting upload…';
      const { uploadUrl } = await api('youtube_upload_start', { id: a.id, size: file.size, type: file.type });
      const video = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'video/*');
        xhr.upload.onprogress = (e) => {
          const pct = Math.round((e.loaded / e.total) * 100);
          bar.style.width = `${pct}%`;
          status.textContent = `Uploading… ${pct}%`;
        };
        xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(`YouTube upload failed (${xhr.status})`)));
        xhr.onerror = () => reject(new Error('Upload interrupted. Try again.'));
        xhr.send(file);
      });
      await api('youtube_upload_done', { id: a.id, videoId: video.id });
      toast('Uploaded to YouTube (private)');
    } catch (err) {
      toast(err.message, 'error');
      status.textContent = err.message;
      box.querySelectorAll('button').forEach((b) => (b.disabled = false));
    } finally {
      box.classList.remove('uploading');
    }
  };
  return box;
}
