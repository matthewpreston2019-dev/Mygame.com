// =============================================================================
// UI services: bottom sheets, toasts, confirm dialogs, confetti, keyboard fix.
// Components call these functions from anywhere; <UiHost/> (components/host.js)
// renders whatever is open.
// =============================================================================

let sheets = [];           // [{ id, render, opts, resolve, closing }]
let toasts = [];           // [{ id, text, type, action, closing }]
let seq = 1;
const listeners = new Set();
const notify = () => { for (const fn of listeners) fn(); };
export function subscribeUi(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const getSheets = () => sheets;
export const getToasts = () => toasts;

/**
 * Open a bottom sheet.
 *   const result = await openSheet(({ close }) => html`...`, { title: 'Add food' });
 * `close(value)` closes it and resolves the promise with value (undefined if
 * dismissed by tapping outside).
 */
export function openSheet(render, opts = {}) {
  return new Promise((resolve) => {
    const id = seq++;
    sheets = [...sheets, { id, render, opts, resolve, closing: false }];
    notify();
  });
}

export function closeSheet(id, value) {
  const s = sheets.find((x) => x.id === id);
  if (!s || s.closing) return;
  s.closing = true;
  sheets = [...sheets];
  notify();
  // Let the slide-down animation play, then remove.
  setTimeout(() => {
    sheets = sheets.filter((x) => x.id !== id);
    notify();
    s.resolve(value);
  }, 210);
}

/** Close the top-most sheet (Escape key / back gesture). */
export function closeTopSheet() {
  const top = sheets.filter((s) => !s.closing).pop();
  if (top && !top.opts.locked) closeSheet(top.id, undefined);
  return !!top;
}

/** Short message at the top of the screen. type: 'ok' | 'error' | 'info' | 'xp' */
export function toast(text, { type = 'ok', action, duration = 2600 } = {}) {
  const id = seq++;
  toasts = [...toasts.slice(-2), { id, text, type, action }];
  notify();
  setTimeout(() => dismissToast(id), action ? duration + 2400 : duration);
  return id;
}

export function dismissToast(id) {
  const tt = toasts.find((x) => x.id === id);
  if (!tt || tt.closing) return;
  tt.closing = true;
  toasts = [...toasts];
  notify();
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== id); notify(); }, 200);
}

/** Light haptic tap where supported (Android). iOS web apps have no vibration API. */
export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

// ---- Confetti ------------------------------------------------------------------
const COLORS = ['#E3B451', '#F2CB6B', '#9CC495', '#C4DDBA', '#3A8660', '#ffffff'];

/** Small celebratory burst. Respects "reduce motion". */
export function confetti({ count = 90, originY = 0.35 } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 60,
    y: innerHeight * originY,
    vx: (Math.random() - 0.5) * 11,
    vy: -Math.random() * 11 - 4,
    r: Math.random() * 360,
    vr: (Math.random() - 0.5) * 18,
    w: 6 + Math.random() * 5,
    h: 9 + Math.random() * 7,
    c: COLORS[(Math.random() * COLORS.length) | 0],
  }));
  const start = performance.now();
  function frame(now) {
    const tt = (now - start) / 1000;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.38; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - tt / 2.2);
      ctx.translate(p.x, p.y);
      ctx.rotate((p.r * Math.PI) / 180);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (tt < 2.2) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

// ---- On-screen keyboard -----------------------------------------------------------
// On iPhone the keyboard covers the bottom of the screen without resizing the
// page. We measure it with visualViewport and expose it as --kb so bottom
// sheets slide up above it.
export function watchKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--kb', `${kb > 60 ? kb : 0}px`);
    document.documentElement.classList.toggle('kb-open', kb > 60);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

/** Copy text, with a toast. */
export async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  if (okMsg) toast(okMsg);
}

/** True when running as an installed home-screen app. */
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

/** Rough platform detection for install instructions. */
export function platform() {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const iosSafari = iOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
  return { iOS, android, iosSafari, desktop: !iOS && !android };
}
