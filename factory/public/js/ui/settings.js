// Settings: connection & access, spending limits, schedules, logs.
import { h, fill, icon, toast, timeAgo, money } from './dom.js';
import { api, token } from '../api.js';
import { state } from '../state.js';
import { openModal, confirmAction } from './modal.js';

let tab = 'general';
let modal = null;
let onTokenSaved = () => {};

export function initSettings({ reconnect }) {
  onTokenSaved = reconnect;
}

export function openSettings(start = 'general') {
  tab = start;
  modal = openModal({ title: 'Settings', body: h('div'), onClose: () => (modal = null) });
  renderSettings();
}

/** Re-render while open. Live updates only refresh the schedules tab, so typing elsewhere is never interrupted. */
export function renderSettings(kinds) {
  if (!modal || (kinds && !(tab === 'schedules' && kinds.has('schedules')))) return;
  const tabs = [['general', 'General'], ['schedules', 'Schedules'], ['logs', 'Logs']];
  fill(modal.body,
    h('div', { class: 'tabs', style: { marginBottom: '16px' } },
      tabs.map(([id, label]) => h('button', { class: `tab${tab === id ? ' active' : ''}`, onclick: () => { tab = id; renderSettings(); } }, label)),
    ),
    VIEWS[tab](),
  );
}

const VIEWS = {
  general() {
    const st = state.status || {};
    const s = state.settings;
    const aiText = { live: 'Live — Claude API connected', demo: 'Demo mode — simulated output', offline: 'No API key on the server — workers cannot run' }[st.ai] || 'Unknown';
    const tokenInput = h('input', { class: 'input', type: 'password', placeholder: 'Paste your FACTORY_TOKEN', value: token.get() });
    const daily = h('input', { class: 'input', type: 'number', min: 0, step: 0.5, value: s.dailyBudgetUsd });
    const monthly = h('input', { class: 'input', type: 'number', min: 0, step: 1, value: s.monthlyBudgetUsd });
    const parallel = h('input', { class: 'input', type: 'number', min: 1, max: 8, value: s.maxParallel });

    const saveLimits = async () => {
      try {
        await api('/api/settings', { method: 'PUT', body: { dailyBudgetUsd: daily.value, monthlyBudgetUsd: monthly.value, maxParallel: parallel.value } });
        toast('Saved');
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    return h('div', {},
      h('div', { class: 'section-title' }, 'Connection'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Backend'), h('dd', {}, state.connected ? '● Connected' : '○ Offline — nothing is shown as running until it reconnects'),
        h('dt', {}, 'AI'), h('dd', {}, aiText),
        h('dt', {}, 'Models'), h('dd', { class: 'mono' }, st.models ? `${st.models.fast} · ${st.models.standard} · ${st.models.strong}` : '—'),
        h('dt', {}, 'Spent'), h('dd', {}, st.spend ? `${money(st.spend.dayUsd)} today · ${money(st.spend.monthUsd)} this month` : '—'),
      ),
      h('label', { class: 'field' }, h('span', {}, 'Access token (stored only in this browser)'),
        h('div', { class: 'inline-form' }, tokenInput, h('button', { class: 'btn', onclick: () => { token.set(tokenInput.value.trim()); toast('Token saved — reconnecting'); onTokenSaved(); } }, 'Save')),
      ),
      h('div', { class: 'section-title' }, 'Limits'),
      h('div', { class: 'grid-3' },
        h('label', { class: 'field' }, h('span', {}, 'Daily budget ($)'), daily),
        h('label', { class: 'field' }, h('span', {}, 'Monthly budget ($)'), monthly),
        h('label', { class: 'field' }, h('span', {}, 'Parallel workers'), parallel),
      ),
      h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '0 0 4px' } }, 'When a budget is reached, work pauses (never silently continues). Raising it resumes paused tasks.'),
      h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: saveLimits }, 'Save limits')),
    );
  },

  schedules() {
    const list = [...state.schedules.values()];
    const rows = list.map((s) => {
      const toggle = h('input', { type: 'checkbox', checked: s.enabled, onchange: () => update(s, { enabled: toggle.checked }) });
      const at = h('input', { class: 'input', type: 'time', value: s.at, style: { width: '130px', height: '30px' }, onchange: () => update(s, { at: at.value }) });
      const every = h('select', { class: 'input', style: { width: '110px', height: '30px' }, onchange: () => update(s, { every: every.value }) },
        ['daily', 'weekly', 'hourly'].map((v) => h('option', { value: v, selected: s.every === v }, v)));
      return h('div', { class: 'card' },
        h('div', { class: 'card-row' },
          h('label', { class: 'switch', title: s.enabled ? 'On' : 'Off' }, toggle, h('i')),
          h('div', { class: 'card-title' }, s.name),
          h('button', { class: 'btn small', title: 'Run now', onclick: () => api(`/api/schedules/${s.id}/run`, { method: 'POST' }).then(() => toast('Started')).catch((e) => toast(e.message, 'error')) }, icon('play'), 'Run'),
          s.kind !== 'briefing' ? h('button', { class: 'btn small danger', title: 'Delete', onclick: () => remove(s) }, icon('trash')) : null,
        ),
        h('div', { class: 'card-meta' }, s.kind === 'briefing' ? 'Summarises the last 24h: results, failures, approvals, spend.' : s.instruction),
        h('div', { class: 'card-row', style: { marginTop: '10px' } }, every, s.every === 'hourly' ? null : at,
          h('span', { class: 'faint', style: { fontSize: '12px', marginLeft: 'auto' } }, s.enabled ? `next ${new Date(s.nextRun).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'paused', s.lastRun ? ` · last ${timeAgo(s.lastRun)}` : ''),
        ),
      );
    });

    const name = h('input', { class: 'input', placeholder: 'Name, e.g. Minecraft trend scan' });
    const cloud = h('select', { class: 'input' }, state.clouds.map((c) => h('option', { value: c.id }, c.name)));
    const instruction = h('textarea', { class: 'input', placeholder: 'What should the worker do each time?' });
    const every = h('select', { class: 'input' }, ['daily', 'weekly', 'hourly'].map((v) => h('option', { value: v }, v)));
    const at = h('input', { class: 'input', type: 'time', value: '09:00' });
    const add = async () => {
      try {
        await api('/api/schedules', { method: 'POST', body: { name: name.value, cloudId: cloud.value, instruction: instruction.value, every: every.value, at: at.value } });
        toast('Schedule added');
        renderSettings();
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    return h('div', {},
      h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: 0 } }, 'Schedules run on the server, even when this device is off. Recurring research reports only what changed since last time. You can also just ask in the chat: “every Monday at 9, scan Minecraft server trends”.'),
      rows.length ? rows : h('div', { class: 'empty' }, 'No schedules.'),
      h('div', { class: 'section-title' }, 'New schedule'),
      h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', {}, 'Name'), name), h('label', { class: 'field' }, h('span', {}, 'Area'), cloud)),
      h('label', { class: 'field' }, h('span', {}, 'Instruction'), instruction),
      h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', {}, 'Every'), every), h('label', { class: 'field' }, h('span', {}, 'At (server time)'), at)),
      h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: add }, icon('plus'), 'Add schedule')),
    );
  },

  logs() {
    const box = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
    api('/api/logs')
      .then((entries) => fill(box,
        entries.length
          ? entries.map((e) => h('div', { class: `log-line ${e.level}` },
              h('span', { class: 'faint' }, new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })),
              h('span', {}, h('span', { class: 'ev mono' }, e.event), ' ', h('span', { class: 'muted' }, e.title || e.summary || e.error || e.skill || e.name || '')),
            ))
          : h('div', { class: 'empty' }, 'No log entries since the server started. Full logs are in data/logs/.'),
      ))
      .catch((err) => fill(box, err.message));
    return box;
  },
};

async function update(s, changes) {
  try {
    await api(`/api/schedules/${s.id}`, { method: 'PUT', body: changes });
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function remove(s) {
  if (!(await confirmAction('Delete schedule?', `“${s.name}” will stop running.`, 'Delete'))) return openSettings('schedules');
  await api(`/api/schedules/${s.id}`, { method: 'DELETE' }).catch((err) => toast(err.message, 'error'));
  openSettings('schedules');
}
