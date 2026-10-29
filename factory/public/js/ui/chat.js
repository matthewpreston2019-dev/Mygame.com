// The chat: talk to the manager naturally; it plans the work and starts the workers.
import { h, fill, icon, STATUS, toast } from './dom.js';
import { api } from '../api.js';
import { state, cloudById } from '../state.js';
import { openResult } from './tasks.js';

const $log = () => document.getElementById('chat-log');
const $input = () => document.getElementById('chat-input');
const $send = () => document.getElementById('chat-send');
let sending = false;
let onFocusCloud = () => {};

export function initChat({ focusCloud }) {
  onFocusCloud = focusCloud;
  const input = $input();
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    updateComposer();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  document.getElementById('chat-toggle').addEventListener('click', () => toggleLog());
  input.addEventListener('focus', () => state.chat.length && toggleLog(true));
}

export function toggleLog(show = $log().classList.contains('hidden')) {
  $log().classList.toggle('hidden', !show);
  if (show) $log().scrollTop = $log().scrollHeight;
}

async function send() {
  const text = $input().value.trim();
  if (!text || sending || !state.connected) return;
  sending = true;
  $input().value = '';
  $input().style.height = 'auto';
  toggleLog(true);
  renderChat();
  try {
    await api('/api/chat', { method: 'POST', body: { text } });
  } catch (err) {
    toast(err.message, 'error');
    $input().value = text;
  } finally {
    sending = false;
    renderChat();
  }
}

export function updateComposer() {
  const input = $input();
  input.disabled = !state.connected;
  input.placeholder = state.connected
    ? state.status?.ai === 'offline' ? 'Add an API key on the server to start workers…' : 'Ask your factory…'
    : 'Backend offline — reconnecting…';
  $send().disabled = !state.connected || sending || !input.value.trim();
}

export function renderChat() {
  const log = $log();
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const messages = state.chat.slice(-60).map(message);
  if (sending) messages.push(h('div', { class: 'msg manager' }, h('div', { class: 'who' }, h('span', { class: 'dot info' }), 'Manager'), h('span', { class: 'typing' }, h('i'), h('i'), h('i'))));
  if (!messages.length) messages.push(h('div', { class: 'muted', style: { textAlign: 'center', padding: '8px' } }, 'Tell the factory what you need. Independent parts run in parallel.'));
  fill(log, messages);
  if (atBottom || sending) log.scrollTop = log.scrollHeight;
  updateComposer();
}

function message(m) {
  if (m.role === 'user') return h('div', { class: 'msg user' }, m.text);
  const tasks = (m.taskIds || []).map((id) => state.tasks.get(id)).filter(Boolean);
  const schedules = (m.scheduleIds || []).map((id) => state.schedules.get(id)).filter(Boolean);
  return h('div', { class: `msg manager${m.error ? ' error' : ''}` },
    h('div', { class: 'who' }, h('span', { class: 'dot info' }), 'Manager'),
    m.text,
    tasks.length || schedules.length
      ? h('div', { class: 'task-chips' },
          tasks.map((t) => {
            const s = STATUS[t.status] || STATUS.new;
            return h('button', { class: 'chip', title: `${cloudById(t.cloudId)?.name} · ${t.stage}`, onclick: () => (t.resultPath ? openResult(t) : onFocusCloud(t.cloudId)) },
              h('span', { class: `dot ${state.connected ? s.dot : ''}` }), t.title, t.status === 'running' && state.connected ? ` · ${t.progress}%` : '');
          }),
          schedules.map((s) => h('span', { class: 'chip info' }, icon('play'), `${s.name} · ${s.every} ${s.every === 'hourly' ? '' : s.at}`)),
        )
      : null,
  );
}
