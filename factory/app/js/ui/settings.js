// Settings: General (status, limits) · AI (Gemini key) · Connections (Google, Obsidian) · Schedules · Logs
import { h, fill, icon, toast, timeAgo } from './dom.js';
import { api, sb, loadLogs } from '../api.js';
import { SUPABASE_URL } from '../config.js';
import { state, aiMode, schedulerHealthy } from '../state.js';
import { openModal, confirmAction } from './modal.js';

let tab = 'general';
let modal = null;

export function openSettings(start = 'general') {
  tab = start;
  modal = openModal({ title: 'Settings', body: h('div'), onClose: () => (modal = null) });
  renderSettings();
}

/** Re-render while open, unless you are typing in it. */
export function renderSettings(kinds) {
  if (!modal) return;
  if (kinds) {
    const relevant = kinds.has('settings') || (tab === 'schedules' && kinds.has('schedules'));
    const typing = modal.body.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (!relevant || typing || tab === 'logs') return;
  }
  const tabs = [['general', 'General'], ['ai', 'AI'], ['connections', 'Connections'], ['schedules', 'Schedules'], ['logs', 'Logs']];
  fill(modal.body,
    h('div', { class: 'tabs', style: { marginBottom: '16px', overflowX: 'auto' } },
      tabs.map(([id, label]) => h('button', { class: `tab${tab === id ? ' active' : ''}`, onclick: () => { tab = id; renderSettings(); } }, label)),
    ),
    VIEWS[tab](),
  );
}

const run = async (action, body, success) => {
  try {
    const result = await api(action, body);
    if (success) toast(success);
    return result;
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
};

const steps = (...items) => h('ol', { class: 'steps' }, items.map((i) => h('li', {}, i)));
const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const section = (title) => h('div', { class: 'section-title' }, title);

const VIEWS = {
  general() {
    const s = state.settings;
    const parallel = h('input', { class: 'input', type: 'number', min: 1, max: 6, value: s.maxParallel });
    const limit = h('input', { class: 'input', type: 'number', min: 1, max: 2000, value: s.dailyRequestLimit });
    const verifyBox = h('input', { type: 'checkbox', checked: s.verifyResults });
    const save = () => run('settings_update', { max_parallel: parallel.value, daily_request_limit: limit.value, verify_results: verifyBox.checked }, 'Saved').catch(() => {});

    return h('div', {},
      section('Status'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Live connection'), h('dd', {}, state.connected ? '● Connected' : '○ Offline — nothing is shown as running until it reconnects'),
        h('dt', {}, 'AI'), h('dd', {}, { live: `Gemini · ${s.models?.standard ?? ''}`, demo: 'Demo mode — simulated output', offline: 'No Gemini key yet' }[aiMode()]),
        h('dt', {}, 'Background jobs'), h('dd', {}, schedulerHealthy() ? `Running · last check ${timeAgo(s.lastTickAt)}` : `Not running since ${s.lastTickAt ? timeAgo(s.lastTickAt) : 'never'} — schedules are delayed`),
        h('dt', {}, 'AI used today'), h('dd', {}, `${s.requestsDay === new Date().toISOString().slice(0, 10) ? s.requestsToday : 0} of ${s.dailyRequestLimit} requests`),
        h('dt', {}, 'Time zone'), h('dd', {}, s.timezone),
      ),
      section('Limits'),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', {}, 'Workers at the same time'), parallel),
        h('label', { class: 'field' }, h('span', {}, 'AI requests per day'), limit),
      ),
      h('label', { class: 'check' }, verifyBox, h('span', {}, 'Check every result automatically (uses one extra request per task)')),
      h('p', { class: 'muted small' }, "Gemini's free tier allows only a few dozen requests a day. When the daily number is used up, work pauses and continues tomorrow. It never silently fails."),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn danger', onclick: () => sb.auth.signOut() }, 'Sign out'),
        h('button', { class: 'btn primary', onclick: save }, 'Save'),
      ),
    );
  },

  ai() {
    const s = state.settings;
    const key = h('input', { class: 'input mono', type: 'password', placeholder: 'AIza…', autocomplete: 'off' });
    const save = async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      await run('gemini_key', { key: key.value }, 'Gemini connected').catch(() => {});
      button.disabled = false;
    };
    return h('div', {},
      s.aiReady
        ? h('div', { class: 'connected' }, icon('check'), h('div', {}, h('b', {}, 'Gemini is connected'), h('div', { class: 'muted small' }, `Main model ${s.models?.standard} · quick model ${s.models?.fast} (chosen automatically)`)))
        : h('p', { class: 'muted' }, 'The workers think with Google Gemini. Its free tier needs no card.'),
      section(s.aiReady ? 'Replace key' : 'Get your free key (1 minute)'),
      steps(
        h('span', {}, 'Open ', link('https://aistudio.google.com/apikey', 'aistudio.google.com/apikey'), ' and sign in with matthew.preston2019@gmail.com.'),
        'Click "Create API key" and copy it.',
        'Paste it below and press Save. The key is stored on the server only, never in this browser.',
      ),
      h('div', { class: 'inline-form' }, key, h('button', { class: 'btn primary', onclick: save }, 'Save')),
      h('p', { class: 'muted small' }, 'Note: on the free tier Google may use what you send to improve its models. Don\'t send anything private you wouldn\'t want reviewed.'),
      s.aiReady ? h('div', { class: 'row-actions' }, h('button', { class: 'btn danger small', onclick: () => run('gemini_remove', {}, 'Key removed').catch(() => {}) }, 'Remove key')) : null,
    );
  },

  connections() {
    const s = state.settings;
    const g = s.google || {};
    const o = s.obsidian || {};
    const redirect = `${SUPABASE_URL}/functions/v1/factory/google/callback`;
    const clientId = h('input', { class: 'input mono', placeholder: '…apps.googleusercontent.com' });
    const clientSecret = h('input', { class: 'input mono', type: 'password', placeholder: 'GOCSPX-…' });
    const repo = h('input', { class: 'input mono', placeholder: 'matthewpreston2019-dev/obsidian-vault', value: o.repo || '' });
    const ghToken = h('input', { class: 'input mono', type: 'password', placeholder: 'github_pat_…' });
    const folder = h('input', { class: 'input', value: o.folder || 'Factory' });
    const emailBox = h('input', { type: 'checkbox', checked: s.emailBriefings, onchange: () => run('settings_update', { email_briefings: emailBox.checked }, 'Saved').catch(() => {}) });

    const connectGoogle = async () => {
      if (clientId.value || clientSecret.value) await run('google_client', { clientId: clientId.value, clientSecret: clientSecret.value });
      const { url } = await run('google_auth_url', {});
      location.href = url;
    };

    return h('div', {},
      // Google
      section('Google — Gmail & YouTube'),
      g.connected
        ? h('div', {},
            h('div', { class: 'connected' }, icon('check'), h('div', {}, h('b', {}, `Connected as ${g.email}`), h('div', { class: 'muted small' }, g.channel ? `YouTube channel: ${g.channel.title}` : 'No YouTube channel found on this account'))),
            h('label', { class: 'check' }, emailBox, h('span', {}, 'Email me the daily briefing')),
            h('p', { class: 'muted small' }, 'Workers can draft emails and YouTube uploads; nothing is sent or uploaded until you approve it under 🔔.'),
            h('div', { class: 'row-actions' }, h('button', { class: 'btn danger small', onclick: () => run('google_disconnect', {}, 'Google disconnected').catch(() => {}) }, 'Disconnect')),
          )
        : h('div', {},
            g.error ? h('p', { class: 'chip bad' }, g.error) : null,
            h('p', { class: 'muted small' }, 'Free, one-time setup (about 10 minutes) in your own Google Cloud project:'),
            steps(
              h('span', {}, 'Open ', link('https://console.cloud.google.com/projectcreate', 'Google Cloud Console'), ' signed in as matthew.preston2019@gmail.com and create a project called "Worker Factory".'),
              h('span', {}, 'Enable the ', link('https://console.cloud.google.com/apis/library/gmail.googleapis.com', 'Gmail API'), ' and the ', link('https://console.cloud.google.com/apis/library/youtube.googleapis.com', 'YouTube Data API v3'), '.'),
              h('span', {}, 'Open ', link('https://console.cloud.google.com/auth/overview', 'Google Auth Platform'), ': choose External, fill in the app name and your email. Under Audience press "Publish app" (otherwise Google signs you out every 7 days).'),
              h('span', {}, 'Under Clients, create an OAuth client of type "Web application" and add this Authorised redirect URI:', h('code', { class: 'copyable', onclick: () => navigator.clipboard?.writeText(redirect).then(() => toast('Copied')) }, redirect)),
              'Paste the Client ID and Client secret below, then press Connect. Google will warn that the app isn\'t verified: choose Advanced → Go to Worker Factory. It\'s your own app.',
            ),
            h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', {}, 'Client ID'), clientId), h('label', { class: 'field' }, h('span', {}, 'Client secret'), clientSecret)),
            h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: () => connectGoogle().catch(() => {}) }, g.clientSaved ? 'Connect Google' : 'Save & connect')),
          ),

      // Obsidian
      section('Obsidian — second brain'),
      o.connected
        ? h('div', {},
            h('div', { class: 'connected' }, icon('check'), h('div', {}, h('b', {}, `Vault: ${o.repo}`), h('div', { class: 'muted small' }, `Results are saved in "${o.folder}/<area>/<project>". Your notes are used as context. Skills: "${o.folder}/Skills".`))),
            h('div', { class: 'row-actions' }, h('button', { class: 'btn danger small', onclick: () => run('obsidian_disconnect', {}, 'Vault disconnected').catch(() => {}) }, 'Disconnect')),
          )
        : h('div', {},
            h('p', { class: 'muted small' }, 'The factory reads and writes your vault through a free private GitHub repository, kept in sync on your PC and iPhone by the free Obsidian Git plugin.'),
            steps(
              h('span', {}, 'Create a ', h('b', {}, 'private'), ' repository on ', link('https://github.com/new', 'github.com/new'), ', e.g. "obsidian-vault".'),
              'In Obsidian: Settings → Community plugins → Browse → install "Git" (by Vinzent) → enable it, then use its "Clone an existing remote repo" command, or push your existing vault to the new repository.',
              h('span', {}, 'Create a ', link('https://github.com/settings/personal-access-tokens/new', 'fine-grained token'), ': only that repository, permission "Contents: Read and write".'),
              'Enter the repository and token below.',
            ),
            h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', {}, 'Repository'), repo), h('label', { class: 'field' }, h('span', {}, 'Folder for factory notes'), folder)),
            h('label', { class: 'field' }, h('span', {}, 'GitHub token'), ghToken),
            h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: () => run('obsidian_connect', { repo: repo.value, token: ghToken.value, folder: folder.value }, 'Vault connected').catch(() => {}) }, 'Connect vault')),
          ),
    );
  },

  schedules() {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const rows = [...state.schedules.values()].map((s) => {
      const toggle = h('input', { type: 'checkbox', checked: s.enabled, onchange: () => update(s, { enabled: toggle.checked }) });
      const at = h('input', { class: 'input', type: 'time', value: s.at, style: { width: '130px', height: '30px' }, onchange: () => update(s, { at: at.value }) });
      const every = h('select', { class: 'input', style: { width: '110px', height: '30px' }, onchange: () => update(s, { every: every.value }) },
        ['daily', 'weekly', 'hourly'].map((v) => h('option', { value: v, selected: s.every === v }, v)));
      const weekday = h('select', { class: 'input', style: { width: '80px', height: '30px' }, onchange: () => update(s, { weekday: Number(weekday.value) }) },
        days.map((d, i) => h('option', { value: i, selected: s.weekday === i }, d)));
      return h('div', { class: 'card' },
        h('div', { class: 'card-row' },
          h('label', { class: 'switch', title: s.enabled ? 'On' : 'Off' }, toggle, h('i')),
          h('div', { class: 'card-title' }, s.name),
          h('button', { class: 'btn small', title: 'Run now', onclick: () => run('schedule_run', { id: s.id }, 'Started').catch(() => {}) }, icon('play'), 'Run'),
          s.kind !== 'briefing' ? h('button', { class: 'btn small danger', title: 'Delete', onclick: () => remove(s) }, icon('trash')) : null,
        ),
        h('div', { class: 'card-meta' }, s.kind === 'briefing' ? 'Summarises the last 24h: results, failures, approvals, AI usage.' : s.instruction),
        h('div', { class: 'card-row', style: { marginTop: '10px', flexWrap: 'wrap' } }, every, s.every === 'weekly' ? weekday : null, s.every === 'hourly' ? null : at,
          h('span', { class: 'faint', style: { fontSize: '12px', marginLeft: 'auto' } }, s.enabled ? `next ${new Date(s.nextRun).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'paused', s.lastRun ? ` · last ${timeAgo(s.lastRun)}` : ''),
        ),
      );
    });

    const name = h('input', { class: 'input', placeholder: 'Name, e.g. Minecraft trend scan' });
    const cloud = h('select', { class: 'input' }, state.clouds.map((c) => h('option', { value: c.id }, c.name)));
    const instruction = h('textarea', { class: 'input', placeholder: 'What should the worker do each time?' });
    const every = h('select', { class: 'input' }, ['daily', 'weekly', 'hourly'].map((v) => h('option', { value: v }, v)));
    const at = h('input', { class: 'input', type: 'time', value: '09:00' });
    const add = () => run('schedule_create', { name: name.value, cloudId: cloud.value, instruction: instruction.value, every: every.value, at: at.value }, 'Schedule added').then(() => renderSettings()).catch(() => {});

    return h('div', {},
      h('p', { class: 'muted small', style: { marginTop: 0 } }, `Schedules run in the cloud, even when your devices are off (times are ${state.settings.timezone}). Recurring research reports only what changed. You can also just ask in the chat: "every Monday at 9, scan Minecraft server trends".`),
      rows.length ? rows : h('div', { class: 'empty' }, 'No schedules.'),
      section('New schedule'),
      h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', {}, 'Name'), name), h('label', { class: 'field' }, h('span', {}, 'Area'), cloud)),
      h('label', { class: 'field' }, h('span', {}, 'Instruction'), instruction),
      h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', {}, 'Every'), every), h('label', { class: 'field' }, h('span', {}, 'At'), at)),
      h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: add }, icon('plus'), 'Add schedule')),
    );
  },

  logs() {
    const box = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
    loadLogs()
      .then((entries) => fill(box,
        entries.length
          ? entries.map((e) => h('div', { class: `log-line ${e.level}` },
              h('span', { class: 'faint' }, new Date(e.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
              h('span', {}, h('span', { class: 'ev mono' }, e.event), ' ', h('span', { class: 'muted' }, e.data?.title || e.data?.summary || e.data?.error || e.data?.skill || e.data?.name || e.data?.note || '')),
            ))
          : h('div', { class: 'empty' }, 'No log entries yet.'),
      ))
      .catch((err) => fill(box, err.message));
    return box;
  },
};

const update = (s, changes) => run('schedule_update', { id: s.id, ...changes }).catch(() => {});

async function remove(s) {
  const ok = await confirmAction('Delete schedule?', `“${s.name}” will stop running.`, 'Delete');
  if (ok) await run('schedule_delete', { id: s.id }, 'Deleted').catch(() => {});
  openSettings('schedules');
}
