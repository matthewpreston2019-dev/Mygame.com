// =============================================================================
// Entry point: set the language, start the UI, register the service worker.
// =============================================================================

import { html, render } from './lib/preact.js';
import { setLanguage } from './lib/i18n.js';
import { watchKeyboard, toast } from './lib/ui.js';
import { t } from './lib/i18n.js';
import { App } from './app.js';

let lang = 'en';
try { lang = localStorage.getItem('dc.lang') || 'en'; } catch { /* storage blocked */ }
await setLanguage(lang);

watchKeyboard();
render(html`<${App} />`, document.getElementById('app'));

// ---- Service worker (offline + push) -------------------------------------------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // A new version was deployed: offer to switch now.
    const offer = (worker) => {
      toast(t('app.updateReady'), {
        type: 'info',
        duration: 8000,
        action: { label: t('app.update'), fn: () => worker.postMessage({ type: 'skipWaiting' }) },
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) offer(nw);
      });
    });
    // Check for updates whenever the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((e) => console.warn('SW registration failed', e));

  // Reload once the new version takes over — but not on the very first
  // install (then there was no old version to replace).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });

  // Tapping a notification while the app is open → go to that screen.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && e.data.url) {
      const hash = new URL(e.data.url).hash;
      if (hash && location.hash !== hash) location.hash = hash;
    }
  });
}
