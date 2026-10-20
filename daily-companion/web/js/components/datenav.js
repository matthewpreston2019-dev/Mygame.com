// "‹  Today  ›" date switcher used by the Track sections.
import { html } from '../lib/preact.js';
import { t, fmtDate } from '../lib/i18n.js';
import { addDays } from '../shared/time.js';
import { Icon } from './icons.js';

export function DateNav({ date, today, onChange, allowFuture = false }) {
  const label = date === today ? t('common.today') : date === addDays(today, -1) ? t('common.yesterday') : date === addDays(today, 1) ? t('common.tomorrow') : fmtDate(date, 'short');
  return html`<div class="cal-nav">
    <button class="icon-btn" aria-label=${t('common.previous')} onClick=${() => onChange(addDays(date, -1))}><${Icon} name="back" class="flip" /></button>
    <button class="grow" style="border:0;background:none;color:inherit;font:inherit;font-weight:700" onClick=${() => onChange(today)}>
      ${label}${date !== today && html`<div class="tiny faint" style="font-weight:500">${fmtDate(date, 'full')}</div>`}
    </button>
    <button class="icon-btn" aria-label=${t('common.next')} disabled=${!allowFuture && date >= today} style=${!allowFuture && date >= today ? 'opacity:.3' : ''}
      onClick=${() => onChange(addDays(date, 1))}><${Icon} name="chev" class="flip" /></button>
  </div>`;
}
