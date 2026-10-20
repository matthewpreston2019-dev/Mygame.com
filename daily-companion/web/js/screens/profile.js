// =============================================================================
// Profile tab: your level & streaks, all settings, account and data.
// Each settings area opens as a bottom sheet (see screens/settings/*).
// =============================================================================

import { html, useEffect, useState } from '../lib/preact.js';
import * as store from '../lib/store.js';
import { supa, callFunction } from '../lib/supa.js';
import { t, fmtNum, getLang, fmtClock } from '../lib/i18n.js';
import { LANGUAGES } from '../shared/defaults.js';
import { Icon } from '../components/icons.js';
import { Ring, Seg, SheetFrame, confirmDialog, Bar } from '../components/common.js';
import { openSheet, toast, isStandalone } from '../lib/ui.js';
import { today } from '../lib/quests.js';
import { APP_VERSION } from '../config.js';
import { openScheduleSheet } from './settings/schedule.js';
import { openTargetsSheet } from './settings/targets.js';
import { openNotificationsSheet } from './settings/notifications.js';
import { openQuestsSheet } from './settings/quests.js';
import { openTemplatesSheet } from './settings/templates.js';
import { openStepsShortcutSheet } from './settings/steps-shortcut.js';
import { openInstallSheet } from './install-prompt.js';
import { showRecoveryCode } from './auth.js';
import { applyTheme } from '../lib/theme.js';
import { setLanguage } from '../lib/i18n.js';
import { pushSupport } from '../lib/push.js';

export function ProfileScreen() {
  const s = store.settings();
  const stats = store.stats();
  const lvl = stats.level;
  const td = today();
  const streak = stats.streak(td);
  const best = Math.max(streak, stats.bestStreak(td));
  const [email, setEmail] = useState('');
  useEffect(() => { supa.auth.getSession().then(({ data }) => setEmail(data.session?.user?.email || '')); }, []);

  const langName = LANGUAGES.find((l) => l.code === getLang())?.name || 'English';
  const st = store.status;
  const ps = pushSupport();

  const row = (icon, label, value, onClick, color) => html`<button class="li" onClick=${onClick}>
    <span class="li-icon" style=${color ? `background:${color}` : ''}>${typeof icon === 'string' && icon.length <= 2 ? icon : html`<${Icon} name=${icon} />`}</span>
    <span class="grow label">${label}</span>
    ${value != null && html`<span class="value">${value}</span>`}
    <${Icon} name="chev" class="chev" />
  </button>`;

  return html`<div class="screen">
    <div class="screen-head"><div class="grow"><h1 class="title">${t('tabs.profile')}</h1>
      <p class="subtitle ellipsis">${email}</p></div></div>

    <div class="card accent">
      <div class="hero">
        <${Ring} value=${lvl.progress} size=${76} stroke=${7} color="var(--gold)">
          <div><div class="tiny faint">${t('profile.level')}</div><div class="bold" style="font-size:24px">${lvl.level}</div></div>
        </${Ring}>
        <div class="grow">
          <div class="bold" style="font-size:18px">${fmtNum(lvl.xp)} XP</div>
          <div class="small muted">${t('profile.toNext', { n: lvl.span - lvl.into, level: lvl.level + 1 })}</div>
          <div class="mt-8"><${Bar} value=${lvl.progress} gold /></div>
        </div>
      </div>
      <div class="stats mt-16" style="grid-template-columns:1fr 1fr">
        <div class="stat"><div class="v">🔥 ${streak}</div><div class="l">${t('profile.streak')}</div></div>
        <div class="stat"><div class="v">🏆 ${best}</div><div class="l">${t('profile.bestStreak')}</div></div>
      </div>
    </div>

    <div class="section-title">${t('profile.plan')}</div>
    <div class="list">
      ${row('calendar', t('settings.schedule'), null, openScheduleSheet)}
      ${row('target', t('settings.targets'), `${fmtNum(s.targets.kcal)} kcal · ${s.targets.protein} g`, openTargetsSheet)}
      ${row('zap', t('settings.quests'), null, openQuestsSheet)}
      ${row('dumbbell', t('settings.templates'), null, openTemplatesSheet)}
    </div>

    <div class="section-title">${t('profile.app')}</div>
    <div class="list">
      ${row('bell', t('settings.notifications'), ps.permission === 'granted' ? t('common.on') : t('common.off'), openNotificationsSheet)}
      ${row('steps', t('settings.stepsShortcut'), null, openStepsShortcutSheet)}
      ${row('globe', t('settings.language'), langName, openLanguageSheet)}
      <div class="li">
        <span class="li-icon"><${Icon} name="moon" /></span>
        <span class="grow label">${t('settings.theme')}</span>
        <div style="width:200px"><${Seg} value=${s.theme} onChange=${(v) => { applyTheme(v); store.saveSettings({ theme: v }); }}
          options=${[{ value: 'dark', label: t('theme.dark') }, { value: 'light', label: t('theme.light') }, { value: 'system', label: t('theme.auto') }]} /></div>
      </div>
      ${!isStandalone() && row('download', t('install.title'), null, openInstallSheet)}
    </div>

    <div class="section-title">${t('profile.account')}</div>
    <div class="list">
      ${row('sync', t('settings.sync'), st.pending ? t('sync.pending', { n: st.pending }) : st.offline ? t('sync.offline') : st.lastSyncAt ? fmtClock(st.lastSyncAt, s.timezone) : '–', openSyncSheet)}
      ${row('lock', t('settings.password'), null, openPasswordSheet)}
      ${row('sparkle', t('settings.recoveryCode'), null, newRecoveryCode)}
      ${row('download', t('settings.export'), null, exportData)}
      <button class="li" onClick=${signOut}>
        <span class="li-icon" style="background:var(--danger-dim);color:var(--danger)"><${Icon} name="logout" /></span>
        <span class="grow label" style="color:var(--danger)">${t('settings.signOut')}</span>
      </button>
    </div>
    <p class="center faint tiny mt-24">Daily Companion ${APP_VERSION} · ${t('profile.tz', { tz: s.timezone })}</p>
  </div>`;
}

function openLanguageSheet() {
  openSheet(({ close }) => html`<${SheetFrame} title=${t('settings.language')} close=${close}>
    <div class="list">
      ${LANGUAGES.map((l) => html`<button class="li" onClick=${async () => { await setLanguage(l.code); store.saveSettings({ language: l.code }); close(); }}>
        <span class="grow label">${l.name}</span>
        ${getLang() === l.code && html`<span style="color:var(--gold)"><${Icon} name="check" /></span>`}
      </button>`)}
    </div>
  </${SheetFrame}>`);
}

function SyncSheet({ close }) {
  const st = store.status;
  const s = store.settings();
  const [busy, setBusy] = useState(false);
  return html`<${SheetFrame} title=${t('settings.sync')} close=${close}>
    <div class="list">
      <div class="li"><span class="grow">${t('sync.status')}</span><span class="value">${st.syncing ? t('sync.syncing') : st.offline ? t('sync.offline') : t('sync.online')}</span></div>
      <div class="li"><span class="grow">${t('sync.waiting')}</span><span class="value">${st.pending}</span></div>
      <div class="li"><span class="grow">${t('sync.last')}</span><span class="value">${st.lastSyncAt ? fmtClock(st.lastSyncAt, s.timezone) : '–'}</span></div>
    </div>
    <p class="small muted mt-12">${t('sync.explain')}</p>
    ${st.failed.length > 0 && html`<div class="banner danger mt-12"><${Icon} name="info" /><span class="grow">${t('sync.failed', { n: st.failed.length })}</span></div>`}
    <button class="btn primary block mt-16" disabled=${busy} onClick=${async () => { setBusy(true); await store.sync(); setBusy(false); toast(store.status.offline ? t('sync.offline') : t('sync.done'), { type: store.status.offline ? 'error' : 'ok' }); }}>
      ${busy ? html`<span class="spinner"></span>` : html`<${Icon} name="sync" />${t('sync.now')}`}
    </button>
  </${SheetFrame}>`;
}
const openSyncSheet = () => openSheet(({ close }) => html`<${SyncSheet} close=${close} />`);

function PasswordSheet({ close }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (pw.length < 8) return setErr(t('auth.shortPassword'));
    if (pw !== pw2) return setErr(t('auth.mismatch'));
    if (!navigator.onLine) return setErr(t('common.offlineTryLater'));
    setBusy(true);
    const { error } = await supa.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(/different/i.test(error.message) ? t('auth.samePassword') : t('common.error'));
    toast(t('auth.passwordChanged'));
    close();
  }
  return html`<${SheetFrame} title=${t('settings.password')} close=${close}
    footer=${html`<button class="btn primary block" disabled=${busy} onClick=${save}>${busy ? html`<span class="spinner"></span>` : t('common.save')}</button>`}>
    <label class="field"><span>${t('auth.newPassword')}</span><input type="password" autocomplete="new-password" value=${pw} onInput=${(e) => { setPw(e.currentTarget.value); setErr(''); }} /></label>
    <label class="field"><span>${t('auth.repeatPassword')}</span><input type="password" autocomplete="new-password" value=${pw2} onInput=${(e) => { setPw2(e.currentTarget.value); setErr(''); }} /></label>
    ${err && html`<div class="banner danger"><${Icon} name="info" /><span class="grow">${err}</span></div>`}
  </${SheetFrame}>`;
}
const openPasswordSheet = () => openSheet(({ close }) => html`<${PasswordSheet} close=${close} />`);

async function newRecoveryCode() {
  const ok = await confirmDialog({ title: t('settings.recoveryCode'), text: t('settings.recoveryConfirm'), ok: t('settings.recoveryNew') });
  if (!ok) return;
  try {
    const { recoveryCode } = await callFunction('account', { body: { action: 'new_recovery_code' } });
    await showRecoveryCode(recoveryCode);
  } catch (e) {
    toast(e.offline ? t('common.offlineTryLater') : t('common.error'), { type: 'error' });
  }
}

/** Download all your data as a JSON file (or share it on iPhone). */
async function exportData() {
  const tables = Object.keys(store.TABLES);
  const data = { exportedAt: new Date().toISOString(), app: 'Daily Companion', version: APP_VERSION };
  for (const tbl of tables) data[tbl] = store.rows(tbl);
  const name = `daily-companion-${today()}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function signOut() {
  const pending = await store.pendingCount();
  const ok = await confirmDialog({
    title: t('settings.signOut'),
    text: pending ? t('settings.signOutPending', { n: pending }) : t('settings.signOutText'),
    ok: t('settings.signOut'),
    danger: true,
  });
  if (!ok) return;
  await store.reset();
  await supa.auth.signOut({ scope: 'local' }).catch(() => {});
  try { navigator.clearAppBadge?.(); } catch { /* ignore */ }
  location.hash = '#/today';
}
