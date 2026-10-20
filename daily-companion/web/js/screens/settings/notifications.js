// Settings → Notifications: turn push on/off for this device, send a test,
// and choose which coach messages may notify you.
import { html, useEffect, useState } from '../../lib/preact.js';
import * as store from '../../lib/store.js';
import { t, getLang } from '../../lib/i18n.js';
import { SheetFrame, Toggle } from '../../components/common.js';
import { Icon } from '../../components/icons.js';
import { openSheet, toast } from '../../lib/ui.js';
import { pushSupport, enablePush, disablePush, currentSubscription, sendTestPush } from '../../lib/push.js';
import { openInstallSheet } from '../install-prompt.js';

const TYPES = ['plan', 'study', 'gym', 'checkin', 'summary', 'winddown', 'nudges', 'weekly', 'morning'];

function NotificationsSheet({ close }) {
  const s = store.settings();
  const [sub, setSub] = useState(undefined);
  const [busy, setBusy] = useState('');
  const ps = pushSupport();

  const refresh = () => currentSubscription().then((x) => setSub(x || null)).catch(() => setSub(null));
  useEffect(() => { refresh(); }, []);

  let state;
  if (ps.needsInstall) state = 'install';
  else if (!ps.supported) state = 'unsupported';
  else if (ps.permission === 'denied') state = 'blocked';
  else if (ps.permission === 'granted' && sub) state = 'on';
  else state = 'off';

  async function turnOn() {
    setBusy('on');
    try {
      const r = await enablePush();
      if (r === 'enabled') toast(t('notify.enabled'));
      else if (r === 'denied') toast(t('notify.denied'), { type: 'error', duration: 4500 });
      else if (r === 'needs-install') openInstallSheet();
      else if (r === 'offline') toast(t('common.offlineTryLater'), { type: 'error' });
      else toast(t('notify.unsupported'), { type: 'error' });
    } catch { toast(t('common.error'), { type: 'error' }); }
    await refresh();
    setBusy('');
  }
  async function turnOff() {
    setBusy('off');
    try { await disablePush(); toast(t('notify.disabled')); } catch { toast(t('common.error'), { type: 'error' }); }
    await refresh();
    setBusy('');
  }
  async function test() {
    setBusy('test');
    try {
      const r = await sendTestPush(getLang());
      if (r.sent > 0) toast(t('notify.testSent', { n: r.sent }));
      else toast(t('notify.testNone'), { type: 'error', duration: 4500 });
    } catch (e) { toast(e.offline ? t('common.offlineTryLater') : t('common.error'), { type: 'error' }); }
    setBusy('');
  }

  const statusText = {
    on: t('notify.stateOn'), off: t('notify.stateOff'), install: t('notify.installFirst'),
    blocked: t('notify.stateBlocked'), unsupported: t('notify.unsupported'),
  }[state];

  return html`<${SheetFrame} title=${t('settings.notifications')} close=${close}>
    <div class=${`banner ${state === 'on' ? '' : state === 'blocked' || state === 'unsupported' ? 'danger' : 'warn'}`}>
      <${Icon} name=${state === 'on' ? 'bell' : 'info'} /><span class="grow">${sub === undefined ? '…' : statusText}</span>
    </div>
    <div class="col">
      ${state === 'install' && html`<button class="btn primary block" onClick=${openInstallSheet}><${Icon} name="download" />${t('install.title')}</button>`}
      ${state === 'off' && html`<button class="btn primary block" disabled=${!!busy} onClick=${turnOn}>${busy === 'on' ? html`<span class="spinner"></span>` : html`<${Icon} name="bell" />${t('notify.turnOn')}`}</button>`}
      ${state === 'on' && html`<div class="btn-row">
        <button class="btn" disabled=${!!busy} onClick=${test}>${busy === 'test' ? html`<span class="spinner"></span>` : t('notify.test')}</button>
        <button class="btn danger" disabled=${!!busy} onClick=${turnOff}>${t('notify.turnOff')}</button>
      </div>`}
    </div>

    <div class="section-title">${t('notify.which')}</div>
    <div class="list">
      ${TYPES.map((k) => html`<div class="li">
        <span class="grow"><span class="label">${t(`notify.${k}`)}</span><div class="sub">${t(`notify.${k}Desc`)}</div></span>
        <${Toggle} label=${t(`notify.${k}`)} checked=${s.notify[k] !== false} onChange=${(v) => store.saveSettings({ notify: { [k]: v } })} />
      </div>`)}
    </div>
    <p class="small faint mt-12">${t('notify.feedNote')}</p>
  </${SheetFrame}>`;
}

export const openNotificationsSheet = () => openSheet(({ close }) => html`<${NotificationsSheet} close=${close} />`);
