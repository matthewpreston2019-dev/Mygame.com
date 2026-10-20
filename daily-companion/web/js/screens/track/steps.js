// =============================================================================
// Steps: today vs goal, manual entry, weekly chart. Steps can also arrive
// automatically from Apple Health via the iOS Shortcut (Settings).
// =============================================================================

import { html, useState } from '../../lib/preact.js';
import * as store from '../../lib/store.js';
import { t, fmtNum, fmtDate, fmtClock } from '../../lib/i18n.js';
import { useClock } from '../../lib/clock.js';
import { addDays, weekStart, dateRange } from '../../shared/time.js';
import { Ring, BarChart, SheetFrame, Field, confirmDialog } from '../../components/common.js';
import { Icon } from '../../components/icons.js';
import { openSheet, toast, haptic } from '../../lib/ui.js';
import { openStepsShortcutSheet } from '../settings/steps-shortcut.js';
import { num } from '../onboarding.js';

export function StepsSection() {
  const { date: today, tz } = useClock();
  const [ws, setWs] = useState(weekStart(today));
  const s = store.settings();
  const stats = store.stats();
  const td = stats.day(today);
  const goal = s.targets.steps;
  const days = dateRange(ws, addDays(ws, 6));
  const data = days.map((d) => ({ label: fmtDate(d, 'narrow'), value: stats.day(d).steps || 0, highlight: d === today }));
  const logged = days.filter((d) => d <= today && stats.day(d).steps != null);
  const avg = logged.length ? Math.round(logged.reduce((a, d) => a + stats.day(d).steps, 0) / logged.length) : null;
  const hit = logged.filter((d) => stats.day(d).steps >= goal).length;
  const row = store.find('steps', { date: today });

  return html`
    <div class="card">
      <div class="row" style="gap:16px">
        <${Ring} value=${(td.steps || 0) / goal} size=${96} stroke=${9}>
          <div><div class="bold tnum" style="font-size:19px">${td.steps == null ? '–' : fmtNum(td.steps)}</div><div class="tiny faint">/ ${fmtNum(goal)}</div></div>
        </${Ring}>
        <div class="grow">
          <div class="bold">${td.steps == null ? t('steps.noneToday') : td.steps >= goal ? t('steps.goalHit') : t('steps.toGo', { n: fmtNum(goal - td.steps) })}</div>
          ${row && html`<div class="small muted mt-4">${row.source === 'shortcut' ? t('steps.fromHealth', { time: fmtClock(row.updated_at, tz) }) : t('steps.manual')}</div>`}
          <button class="btn primary small mt-12" onClick=${() => openStepsEntry(today)}><${Icon} name="edit" />${t('steps.log')}</button>
        </div>
      </div>
    </div>

    <div class="section-title">${t('steps.week')}</div>
    <div class="card">
      <div class="cal-nav" style="margin-bottom:6px">
        <button class="icon-btn" aria-label=${t('common.previous')} onClick=${() => setWs(addDays(ws, -7))}><${Icon} name="back" class="flip" /></button>
        <div class="grow small">${fmtDate(ws, 'dayMonth')} – ${fmtDate(addDays(ws, 6), 'dayMonth')}</div>
        <button class="icon-btn" aria-label=${t('common.next')} disabled=${addDays(ws, 7) > today} style=${addDays(ws, 7) > today ? 'opacity:.3' : ''} onClick=${() => setWs(addDays(ws, 7))}><${Icon} name="chev" class="flip" /></button>
      </div>
      <${BarChart} data=${data} goal=${goal} formatValue=${(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v)} />
      <div class="row between mt-8 small muted">
        <span>${t('steps.avg', { n: avg == null ? '–' : fmtNum(avg) })}</span>
        <span>${t('steps.daysHit', { n: hit, total: logged.length })}</span>
      </div>
    </div>

    <button class="card" style="width:100%;text-align:start;color:inherit;display:block;margin-top:12px" onClick=${openStepsShortcutSheet}>
      <div class="row"><span class="li-icon">⚡</span><div class="grow"><div class="bold">${t('steps.autoTitle')}</div><div class="small muted">${t('steps.autoText')}</div></div><${Icon} name="chev" class="chev" /></div>
    </button>`;
}

function StepsForm({ date, close }) {
  const { date: today } = useClock();
  const [d, setD] = useState(date);
  const existing = store.find('steps', { date: d });
  const [v, setV] = useState(existing ? String(existing.steps) : '');
  const [err, setErr] = useState('');
  const options = Array.from({ length: 7 }, (_, i) => addDays(today, -i));

  function save() {
    const n = num(String(v).replace(/[.,\s']/g, ''));
    if (!(Number.isInteger(n) && n >= 0 && n <= 200000)) return setErr(t('validate.range', { min: 0, max: 200000 }));
    store.put('steps', { date: d, steps: n, source: 'manual' });
    haptic();
    toast(t('common.saved'));
    close(true);
  }
  async function del() {
    if (!(await confirmDialog({ title: t('steps.delete'), ok: t('common.delete'), danger: true }))) return;
    store.remove('steps', { date: d });
    close(true);
  }

  return html`<${SheetFrame} title=${t('steps.log')} close=${close}
    footer=${html`<div class="btn-row">${existing && html`<button class="btn danger" onClick=${del}>${t('common.delete')}</button>`}<button class="btn primary" onClick=${save}>${t('common.save')}</button></div>`}>
    <label class="field"><span>${t('common.date')}</span>
      <select value=${d} onChange=${(e) => { const nd = e.currentTarget.value; setD(nd); const ex = store.find('steps', { date: nd }); setV(ex ? String(ex.steps) : ''); setErr(''); }}>
        ${options.map((o) => html`<option value=${o}>${o === today ? t('common.today') : fmtDate(o, 'short')}</option>`)}
      </select></label>
    <${Field} label=${t('steps.title')} error=${err} hint=${existing?.source === 'shortcut' ? t('steps.overwriteHint') : ''}>
      <input inputmode="numeric" value=${v} placeholder="8000" onInput=${(e) => { setV(e.currentTarget.value); setErr(''); }} /></${Field}>
  </${SheetFrame}>`;
}

export const openStepsEntry = (date) => openSheet(({ close }) => html`<${StepsForm} date=${date} close=${close} />`);
