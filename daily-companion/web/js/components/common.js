// Small reusable UI components.
import { html, useEffect, useState } from '../lib/preact.js';
import { Icon } from './icons.js';
import { t } from '../lib/i18n.js';
import { subscribeUi, getSheets, getToasts, closeSheet, dismissToast, closeTopSheet, openSheet } from '../lib/ui.js';

/** Circular progress ring. value 0..1 (can exceed 1 → full + gold). */
export function Ring({ value = 0, size = 64, stroke = 7, color = 'var(--sage)', track = 'var(--card-3)', children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  const col = value >= 1 ? 'var(--gold)' : color;
  return html`<div class="ring" style=${`width:${size}px;height:${size}px`}>
    <svg width=${size} height=${size}>
      <circle cx=${size / 2} cy=${size / 2} r=${r} stroke=${track} stroke-width=${stroke} />
      <circle cx=${size / 2} cy=${size / 2} r=${r} stroke=${col} stroke-width=${stroke} stroke-linecap="round"
        stroke-dasharray=${c} stroke-dashoffset=${c * (1 - v)} />
    </svg>
    <div class="ring-center">${children}</div>
  </div>`;
}

export function Bar({ value = 0, gold, thin }) {
  const v = Math.max(0, Math.min(1, value || 0));
  return html`<div class=${`bar ${gold || value >= 1 ? 'gold' : ''} ${thin ? 'thin' : ''}`}><i style=${`width:${v * 100}%`}></i></div>`;
}

export function Toggle({ checked, onChange, label, disabled }) {
  return html`<label class="switch">
    <input type="checkbox" role="switch" aria-label=${label} checked=${!!checked} disabled=${disabled}
      onChange=${(e) => onChange(e.currentTarget.checked)} />
    <span class="track"></span><span class="knob"></span>
  </label>`;
}

/** Segmented control: options = [{ value, label }] */
export function Seg({ options, value, onChange }) {
  return html`<div class="seg" role="tablist">
    ${options.map((o) => html`<button type="button" role="tab" aria-selected=${o.value === value}
      class=${o.value === value ? 'active' : ''} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}

export function Empty({ emoji = '🌱', title, text, action }) {
  return html`<div class="empty">
    <div class="em">${emoji}</div>
    ${title && html`<h3>${title}</h3>`}
    ${text && html`<p>${text}</p>`}
    ${action}
  </div>`;
}

/** Consistent sheet layout: title + close button, scrolling body, optional footer. */
export function SheetFrame({ title, close, children, footer }) {
  return html`
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <h2>${title}</h2>
      <button class="icon-btn plain" aria-label=${t('common.close')} onClick=${() => close()}><${Icon} name="x" /></button>
    </div>
    <div class="sheet-body">${children}</div>
    ${footer && html`<div class="sheet-foot">${footer}</div>`}`;
}

/** Renders open sheets and toasts. Mounted once in the app root. */
export function UiHost() {
  const [, force] = useState(0);
  useEffect(() => subscribeUi(() => force((x) => x + 1)), []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeTopSheet(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const sheets = getSheets();
  const toasts = getToasts();
  // Stop the page behind from scrolling while a sheet is open.
  useEffect(() => { document.body.style.overflow = sheets.length ? 'hidden' : ''; }, [sheets.length]);
  return html`
    ${sheets.map((s) => html`
      <div key=${'b' + s.id} class=${`sheet-backdrop ${s.closing ? 'closing' : ''}`}
        onClick=${() => !s.opts.locked && closeSheet(s.id, undefined)}></div>
      <div key=${'s' + s.id} class=${`sheet ${s.closing ? 'closing' : ''}`} role="dialog" aria-modal="true">
        ${s.render({ close: (v) => closeSheet(s.id, v) })}
      </div>`)}
    <div class="toasts" aria-live="polite">
      ${toasts.map((x) => html`<div key=${x.id} class=${`toast ${x.type} ${x.closing ? 'closing' : ''}`} onClick=${() => dismissToast(x.id)}>
        <span class="ti">${x.type === 'error' ? html`<${Icon} name="info" />` : x.type === 'xp' ? html`<${Icon} name="sparkle" />` : x.type === 'info' ? html`<${Icon} name="info" />` : html`<${Icon} name="check" />`}</span>
        <span>${x.text}</span>
        ${x.action && html`<button onClick=${(e) => { e.stopPropagation(); x.action.fn(); dismissToast(x.id); }}>${x.action.label}</button>`}
      </div>`)}
    </div>`;
}

/** Standard yes/no confirmation. Resolves true/false. */
export async function confirmDialog({ title, text, ok, danger }) {
  const res = await openSheet(({ close }) => html`<${SheetFrame} title=${title} close=${close}>
      ${text && html`<p class="muted mb-16">${text}</p>`}
      <div class="btn-row">
        <button class="btn" onClick=${() => close(false)}>${t('common.cancel')}</button>
        <button class=${`btn ${danger ? 'danger' : 'primary'}`} onClick=${() => close(true)}>${ok || t('common.ok')}</button>
      </div>
    </${SheetFrame}>`);
  return res === true;
}

/** Labelled input with validation message. */
export function Field({ label, hint, error, children }) {
  return html`<label class=${`field ${error ? 'invalid' : ''}`}>
    ${label && html`<span>${label}</span>`}
    ${children}
    ${error ? html`<div class="error">${error}</div>` : hint && html`<div class="hint">${hint}</div>`}
  </label>`;
}

/** Simple vertical bar chart (e.g. steps per day) with a dashed goal line. */
export function BarChart({ data, goal, height = 130, labels = true, formatValue }) {
  // data: [{ label, value, highlight, goal? }]
  const w = 320, padB = labels ? 18 : 4, padT = 14;
  const max = Math.max(goal || 0, ...data.map((d) => d.value || 0), 1) * 1.1;
  const bw = w / data.length;
  const y = (v) => padT + (height - padT - padB) * (1 - v / max);
  return html`<svg class="chart" viewBox=${`0 0 ${w} ${height}`} role="img">
    ${data.map((d, i) => {
      const v = d.value || 0;
      const top = y(v);
      // A bar can carry its own goal (e.g. study minutes differ per day).
      const g = d.goal ?? goal;
      const cls = d.highlight ? 'bar-today' : (g ? v >= g : v > 0) ? 'bar-hit' : 'bar-miss';
      return html`<g>
        <rect class=${cls} x=${i * bw + bw * 0.18} y=${top} width=${bw * 0.64} height=${Math.max(0, height - padB - top)} rx="4" />
        ${v > 0 && formatValue && html`<text x=${i * bw + bw / 2} y=${top - 4} text-anchor="middle">${formatValue(v)}</text>`}
        ${labels && html`<text x=${i * bw + bw / 2} y=${height - 4} text-anchor="middle">${d.label}</text>`}
      </g>`;
    })}
    ${goal ? html`<line class="goal" x1="0" x2=${w} y1=${y(goal)} y2=${y(goal)} />` : null}
  </svg>`;
}

/** Line chart (e.g. body weight) with optional dashed goal line. */
export function LineChart({ points, goal, height = 140 }) {
  // points: [{ label, value }]
  if (points.length < 2) return null;
  const w = 320, padT = 12, padB = 18;
  const vals = points.map((p) => p.value).concat(goal ? [goal] : []);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(1, hi - lo);
  const x = (i) => 10 + (i * (w - 20)) / (points.length - 1);
  const y = (v) => padT + (height - padT - padB) * (1 - (v - lo + span * 0.1) / (span * 1.2));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return html`<svg class="chart" viewBox=${`0 0 ${w} ${height}`} role="img">
    ${goal ? html`<line class="goal" x1="0" x2=${w} y1=${y(goal)} y2=${y(goal)} />` : null}
    <path class="line" d=${d} />
    ${points.map((p, i) => html`<circle class="dot" cx=${x(i)} cy=${y(p.value)} r="3" />`)}
    <text x="10" y=${height - 4}>${points[0].label}</text>
    <text x=${w - 10} y=${height - 4} text-anchor="end">${points[points.length - 1].label}</text>
  </svg>`;
}
