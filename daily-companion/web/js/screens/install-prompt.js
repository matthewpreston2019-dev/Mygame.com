// =============================================================================
// One-time "Install the app" popup on the first visit in a browser.
// Android/desktop Chrome: one tap (uses the browser's install prompt).
// iPhone/iPad: shows the Share → "Add to Home Screen" steps.
// Never shown inside the installed app, and only once per browser.
// =============================================================================

import { html, useEffect } from '../lib/preact.js';
import { t } from '../lib/i18n.js';
import { openSheet, isStandalone, platform } from '../lib/ui.js';
import { SheetFrame } from '../components/common.js';
import { IosShareIcon, Icon } from '../components/icons.js';

const SEEN_KEY = 'dc.installPromptSeen';
let deferredPrompt = null;

// Chrome fires this when the app is installable; we keep it for our own button.
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });

export const canOneTapInstall = () => !!deferredPrompt;

export async function oneTapInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome === 'accepted';
}

/** The install instructions, reused by the popup and Settings. */
export function InstallSteps() {
  const p = platform();
  if (p.iOS && !p.iosSafari) {
    return html`<p class="muted">${t('install.iosOtherBrowser')}</p>
      <ol class="steps-list mt-8">
        <li><span>${t('install.iosStep1')} <${IosShareIcon} /></span></li>
        <li><span>${t('install.iosStep2')}</span></li>
        <li><span>${t('install.iosStep3')}</span></li>
      </ol>`;
  }
  if (p.iOS) {
    return html`<ol class="steps-list">
      <li><span>${t('install.iosStep1')} <${IosShareIcon} /></span></li>
      <li><span>${t('install.iosStep2')}</span></li>
      <li><span>${t('install.iosStep3')}</span></li>
    </ol>`;
  }
  if (deferredPrompt) return html`<p class="muted">${t('install.oneTapText')}</p>`;
  return html`<ol class="steps-list">
    <li><span>${p.android ? t('install.androidStep1') : t('install.desktopStep1')}</span></li>
    <li><span>${p.android ? t('install.androidStep2') : t('install.desktopStep2')}</span></li>
  </ol>`;
}

export function openInstallSheet() {
  return openSheet(({ close }) => html`<${SheetFrame} title=${t('install.title')} close=${close}
      footer=${deferredPrompt
        ? html`<button class="btn primary block" onClick=${async () => { await oneTapInstall(); close(); }}><${Icon} name="download" />${t('install.oneTap')}</button>`
        : html`<button class="btn block" onClick=${() => close()}>${t('install.gotIt')}</button>`}>
      <div class="row mb-16">
        <img src="icons/icon-192.png" width="56" height="56" style="border-radius:14px" alt="" />
        <div><div class="bold">Daily Companion</div><div class="muted small">${t('install.why')}</div></div>
      </div>
      <${InstallSteps} />
    </${SheetFrame}>`);
}

/** Mounted in the app root: opens the sheet once, a moment after the first visit. */
export function InstallPrompt() {
  useEffect(() => {
    if (isStandalone()) return;
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { return; }
    if (seen) return;
    const timer = setTimeout(() => {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
      openInstallSheet();
    }, 1500);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
