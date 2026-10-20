// Settings → Steps from Apple Health: your personal link for the iOS Shortcut
// plus step-by-step setup instructions.
import { html, useState } from '../../lib/preact.js';
import * as store from '../../lib/store.js';
import { supa } from '../../lib/supa.js';
import { t, fmtNum, fmtClock, fmtDate } from '../../lib/i18n.js';
import { FUNCTIONS_URL } from '../../config.js';
import { SheetFrame, confirmDialog } from '../../components/common.js';
import { Icon } from '../../components/icons.js';
import { openSheet, toast, copyText } from '../../lib/ui.js';

export const STEPS_URL = `${FUNCTIONS_URL}/steps`;

function StepsShortcutSheet({ close }) {
  const profile = store.profile();
  const token = profile?.steps_token || '';
  const s = store.settings();
  const [busy, setBusy] = useState(false);
  const last = store.rows('steps').filter((r) => r.source === 'shortcut').sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];

  async function regenerate() {
    if (!(await confirmDialog({ title: t('shortcut.newLink'), text: t('shortcut.newLinkText'), ok: t('shortcut.newLink'), danger: true }))) return;
    setBusy(true);
    const { error } = await supa.rpc('regenerate_steps_token');
    if (error) toast(navigator.onLine ? t('common.error') : t('common.offlineTryLater'), { type: 'error' });
    else { await store.sync(); toast(t('shortcut.newLinkDone')); }
    setBusy(false);
  }

  const copyRow = (label, value) => html`<div class="field"><span class="field-label">${label}</span>
    <div class="copy-box"><code>${value}</code>
      <button class="btn small" onClick=${() => copyText(value, t('common.copied'))}><${Icon} name="copy" />${t('common.copy')}</button></div></div>`;

  return html`<${SheetFrame} title=${t('settings.stepsShortcut')} close=${close}>
    <p class="muted mb-12">${t('shortcut.intro')}</p>
    ${last
      ? html`<div class="banner"><${Icon} name="check" /><span class="grow">${t('shortcut.lastReceived', { n: fmtNum(last.steps), date: fmtDate(last.date, 'dayMonth'), time: fmtClock(last.updated_at, s.timezone) })}</span></div>`
      : html`<div class="banner warn"><${Icon} name="info" /><span class="grow">${t('shortcut.notYet')}</span></div>`}

    ${copyRow(t('shortcut.url'), STEPS_URL)}
    ${copyRow(t('shortcut.header'), 'x-steps-token')}
    ${copyRow(t('shortcut.token'), token || '…')}

    <div class="section-title">${t('shortcut.setupTitle')}</div>
    <ol class="steps-list">
      ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => html`<li><span>${t(`shortcut.step${n}`)}</span></li>`)}
    </ol>
    <div class="section-title">${t('shortcut.autoTitle')}</div>
    <ol class="steps-list">
      ${[1, 2, 3, 4].map((n) => html`<li><span>${t(`shortcut.auto${n}`)}</span></li>`)}
    </ol>
    <div class="card mt-12"><p class="small muted">${t('shortcut.doubleCount')}</p></div>
    <p class="small faint mt-12">${t('shortcut.privacy')}</p>
    <button class="btn danger block mt-16" disabled=${busy} onClick=${regenerate}><${Icon} name="refresh" />${t('shortcut.newLink')}</button>
  </${SheetFrame}>`;
}

export const openStepsShortcutSheet = () => openSheet(({ close }) => html`<${StepsShortcutSheet} close=${close} />`);
