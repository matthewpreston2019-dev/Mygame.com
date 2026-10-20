// Dark / light / system theme. index.html applies the saved theme before the
// first paint (no white flash); this keeps it in sync afterwards.

const COLORS = { dark: '#0A1310', light: '#F3F6F1' };
let mode = 'dark';
const mq = matchMedia('(prefers-color-scheme: light)');

function resolve(m) {
  return m === 'system' ? (mq.matches ? 'light' : 'dark') : m === 'light' ? 'light' : 'dark';
}

export function applyTheme(m) {
  mode = m || 'dark';
  const actual = resolve(mode);
  document.documentElement.dataset.theme = actual;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = COLORS[actual];
  try { localStorage.setItem('dc.theme', mode); } catch { /* storage blocked */ }
}

// Follow the phone's setting live when in "system" mode.
mq.addEventListener?.('change', () => { if (mode === 'system') applyTheme('system'); });
