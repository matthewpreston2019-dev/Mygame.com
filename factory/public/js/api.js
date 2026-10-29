// Talking to the factory server: JSON requests plus one live event stream (no polling).
const TOKEN_KEY = 'factory.token';

export const token = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  },
  set: (value) => {
    try { localStorage.setItem(TOKEN_KEY, value); } catch { /* private mode: token lasts this session only */ }
    memoryToken = value;
  },
};
let memoryToken = '';
const currentToken = () => token.get() || memoryToken;

export class AuthError extends Error {}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(currentToken() && { Authorization: `Bearer ${currentToken()}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new AuthError('Access token required');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const EVENTS = ['snapshot', 'task', 'chat', 'approval', 'schedule', 'schedule.removed', 'project', 'project.removed', 'skills', 'settings', 'spend'];

/**
 * Keep a live connection open. Calls onEvent(type, data) for every server event,
 * onState(true|false) when the connection opens or drops, and reconnects with backoff.
 */
export function connect({ onEvent, onState, onAuth }) {
  let source = null;
  let delay = 1000;
  let retryTimer = null;

  async function open() {
    clearTimeout(retryTimer);
    source?.close();
    // A quick authenticated request tells us whether the server is up and the token is valid.
    try {
      await api('/api/health');
    } catch (err) {
      onState(false);
      if (err instanceof AuthError) return onAuth();
      return schedule();
    }
    source = new EventSource(`/api/events${currentToken() ? `?token=${encodeURIComponent(currentToken())}` : ''}`);
    for (const type of EVENTS) source.addEventListener(type, (e) => onEvent(type, JSON.parse(e.data)));
    source.onopen = () => {
      delay = 1000;
      onState(true);
    };
    source.onerror = () => {
      source.close();
      onState(false);
      schedule();
    };
  }

  function schedule() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(open, delay);
    delay = Math.min(delay * 2, 30_000);
  }

  // Phones suspend background tabs: reconnect immediately when the page comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!source || source.readyState === EventSource.CLOSED)) open();
  });
  window.addEventListener('online', open);

  open();
  return { reconnect: open };
}
