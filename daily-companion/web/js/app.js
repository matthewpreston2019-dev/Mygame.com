// =============================================================================
// App root: decides what to show.
//   not signed in        → Auth screen
//   first download       → splash ("Setting up…")
//   not onboarded yet    → Onboarding
//   otherwise            → tabs (Today, Coach, Track, Calendar, Profile)
// =============================================================================

import { html, useEffect, useLayoutEffect, useState } from './lib/preact.js';
import { supa } from './lib/supa.js';
import * as store from './lib/store.js';
import { t, getLang, setLanguage, onLangChange } from './lib/i18n.js';
import { useRoute, navigate } from './lib/router.js';
import { UiHost } from './components/common.js';
import { Icon } from './components/icons.js';
import { AuthScreen } from './screens/auth.js';
import { Onboarding } from './screens/onboarding.js';
import { TodayScreen } from './screens/today.js';
import { CoachScreen } from './screens/coach.js';
import { TrackScreen } from './screens/track.js';
import { CalendarScreen } from './screens/calendar.js';
import { ProfileScreen } from './screens/profile.js';
import { InstallPrompt } from './screens/install-prompt.js';
import { applyTheme } from './lib/theme.js';
import { refreshPushSubscription } from './lib/push.js';
import { reconcileQuests } from './lib/quests.js';

const TABS = [
  { id: 'today', icon: 'today', screen: TodayScreen },
  { id: 'coach', icon: 'coach', screen: CoachScreen },
  { id: 'track', icon: 'track', screen: TrackScreen },
  { id: 'calendar', icon: 'calendar', screen: CalendarScreen },
  { id: 'profile', icon: 'profile', screen: ProfileScreen },
];

export function Splash({ text, action }) {
  return html`<div class="splash"><div>
    <img src="icons/icon-192.png" alt="" width="96" height="96" />
    <div class="bold">Daily Companion</div>
    ${text ? html`<p class="muted small mt-8">${text}</p>` : html`<div class="spinner"></div>`}
    ${action}
  </div></div>`;
}

// The session supabase saved on this device (or null). Offline with an
// expired access token, getSession() answers null although you're still
// signed in: supabase keeps this copy and refreshes it once you're online
// (it deletes it itself, and reports SIGNED_OUT, if the login is really over).
function storedSession() {
  try {
    const s = JSON.parse(localStorage.getItem('dc.auth') || 'null');
    return s?.refresh_token && s?.user?.id ? s : null;
  } catch { return null; }
}

export function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [, setVersion] = useState(0);
  const [, setLangTick] = useState(getLang());

  // Auth state
  useEffect(() => {
    // Fall back to the saved session so the app still opens from the on-device
    // cache when you start it offline.
    supa.auth.getSession()
      .then(({ data }) => setSession(data.session || storedSession()))
      .catch(() => setSession(storedSession()));
    const { data } = supa.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') setSession(null);
      else if (s) setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Re-render whenever local data or the language changes.
  useEffect(() => store.subscribe(() => setVersion((v) => v + 1)), []);
  useEffect(() => onLangChange((l) => setLangTick(l)), []);

  // Load this user's data and start syncing.
  const uid = session?.user?.id;
  useEffect(() => { if (uid) store.init(uid); }, [uid]);

  // The service worker asks us to sync when a push arrives while the app is open.
  useEffect(() => {
    const onMsg = (e) => { if (e.data?.type === 'sync') store.sync(); };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, []);

  const profile = uid && store.status.ready ? store.profile() : null;
  const settings = profile ? store.settings() : null;

  // Apply language + theme from your settings.
  useEffect(() => {
    if (!settings) return;
    applyTheme(settings.theme);
    if (settings.language !== getLang()) setLanguage(settings.language);
  }, [settings?.theme, settings?.language]);

  // Once data is here: keep this device's push subscription fresh and award
  // XP for auto-quests (also catches up days when the app wasn't opened).
  useEffect(() => { if (profile) refreshPushSubscription(); }, [!!profile]);
  useEffect(() => { if (profile && settings?.onboarded) reconcileQuests(); }, [store.getVersion()]);

  let body;
  if (session === undefined) body = html`<${Splash} />`;
  else if (!session) body = html`<${AuthScreen} />`;
  else if (!store.status.ready) body = html`<${Splash} />`;
  else if (!profile) {
    body = store.status.offline
      ? html`<${Splash} text=${t('app.firstSyncOffline')} action=${html`<button class="btn mt-16" onClick=${() => store.sync()}>${t('common.retry')}</button>`} />`
      : html`<${Splash} text=${t('app.settingUp')} />`;
  } else if (!settings.onboarded) body = html`<${Onboarding} />`;
  else body = html`<${Shell} />`;

  return html`${body}<${UiHost} /><${InstallPrompt} />`;
}

function Shell() {
  const path = useRoute();
  const tab = TABS.find((x) => x.id === path[0]) || TABS[0];
  const Screen = tab.screen;
  const unread = store.rows('coach_messages').filter((m) => m.kind === 'coach' && !m.read_at).length;

  // Scroll to top when switching tabs.
  // Layout effect: runs before the new screen's own effects, so a screen that
  // scrolls somewhere on open (e.g. Calendar to the current time) wins.
  useLayoutEffect(() => { scrollTo(0, 0); }, [tab.id]);

  // Keep the app icon badge in sync with unread coach messages (iOS 16.4+ / Android).
  useEffect(() => {
    try { unread ? navigator.setAppBadge?.(unread) : navigator.clearAppBadge?.(); } catch { /* unsupported */ }
  }, [unread]);

  const onTab = (id) => {
    if (id === tab.id) { scrollTo({ top: 0, behavior: 'smooth' }); if (path.length > 1) navigate(id); return; }
    navigate(id);
  };

  return html`
    <main class="app">
      ${store.status.offline && html`<div class="banner warn"><${Icon} name="offline" /><span class="grow">${t('sync.offlineBanner')}</span></div>`}
      ${store.status.storageError && html`<div class="banner danger"><${Icon} name="info" /><span class="grow">${t('sync.storageError')}</span></div>`}
      ${!store.status.offline && store.status.failed.length > 0 && html`<div class="banner danger"><${Icon} name="info" /><span class="grow">${t('sync.failed', { n: store.status.failed.length })}</span>
        <button class="icon-btn plain" style="width:32px;height:32px;margin:-6px;color:inherit" aria-label=${t('common.close')} onClick=${store.clearFailed}><${Icon} name="x" /></button></div>`}
      <${Screen} key=${tab.id} path=${path} />
    </main>
    <nav class="tabbar" aria-label="Tabs"><div class="tabbar-inner">
      ${TABS.map((x) => html`<button class=${`tab ${x.id === tab.id ? 'active' : ''}`} aria-current=${x.id === tab.id ? 'page' : undefined}
        onClick=${() => onTab(x.id)}>
        <${Icon} name=${x.icon} />
        <span>${t(`tabs.${x.id}`)}</span>
        ${x.id === 'coach' && unread > 0 && html`<span class="dot">${unread > 9 ? '9+' : unread}</span>`}
      </button>`)}
    </div></nav>`;
}
