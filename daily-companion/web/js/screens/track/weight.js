// =============================================================================
// Body weight: log, trend chart toward your goal (e.g. 69 kg), weekly change.
// Tip shown in the UI: weigh in the morning, after the toilet, before eating.
// =============================================================================

import { html, useState } from '../../lib/preact.js';
import * as store from '../../lib/store.js';
import { t, fmtNum, fmtDate } from '../../lib/i18n.js';
import { useClock } from '../../lib/clock.js';
import { addDays } from '../../shared/time.js';
import { LineChart, SheetFrame, Field, Empty, confirmDialog } from '../../components/common.js';
import { Icon } from '../../components/icons.js';
import { openSheet, toast, haptic } from '../../lib/ui.js';
import { num } from '../onboarding.js';

const kg = (n) => fmtNum(Number(n), 1);

export function WeightSection() {
  const { date: today } = useClock();
  const s = store.settings();
  const goal = Number(s.targets.goalWeight) || null;
  const all = store.rows('weights').slice().sort((a, b) => a.date.localeCompare(b.date));
  const latest = all[all.length - 1];
  const recent = all.filter((w) => w.date >= addDays(today, -60));
  // 7-day average smooths out daily water swings.
  const avg = (from, to) => { const xs = all.filter((w) => w.date > from && w.date <= to); return xs.length ? xs.reduce((a, w) => a + Number(w.kg), 0) / xs.length : null; };
  const thisWeek = avg(addDays(today, -7), today);
  const lastWeek = avg(addDays(today, -14), addDays(today, -7));
  const change = thisWeek != null && lastWeek != null ? Math.round((thisWeek - lastWeek) * 10) / 10 : null;
  const toGo = latest && goal ? Math.round((Number(latest.kg) - goal) * 10) / 10 : null;

  return html`
    <div class="stats">
      <div class="stat"><div class="v">${latest ? kg(latest.kg) : '–'}<small>kg</small></div><div class="l">${t('weight.current')}</div></div>
      <div class="stat"><div class="v">${goal ? kg(goal) : '–'}<small>kg</small></div><div class="l">${t('weight.goal')}</div></div>
      <div class="stat"><div class="v">${change == null ? '–' : `${change > 0 ? '+' : ''}${kg(change)}`}<small>kg</small></div><div class="l">${t('weight.weekChange')}</div></div>
      <div class="stat"><div class="v">${toGo == null ? '–' : toGo <= 0 ? '✓' : kg(toGo)}${toGo > 0 ? html`<small>kg</small>` : ''}</div><div class="l">${t('weight.toGo')}</div></div>
    </div>
    ${change != null && html`<p class="small muted mt-12">${change < -1 ? t('weight.tooFast') : change < 0 ? t('weight.goodPace') : change === 0 ? t('weight.flat') : t('weight.up')}</p>`}

    <button class="btn primary block mt-12" onClick=${() => openWeightEntry(today)}><${Icon} name="plus" />${t('weight.log')}</button>

    ${recent.length >= 2 && html`<div class="section-title">${t('weight.trend')}</div>
      <div class="card"><${LineChart} points=${recent.map((w) => ({ label: fmtDate(w.date, 'dayMonth'), value: Number(w.kg) }))} goal=${goal} /></div>`}

    <div class="section-title">${t('weight.entries')}</div>
    ${all.length === 0
      ? html`<${Empty} emoji="⚖️" title=${t('weight.emptyTitle')} text=${t('weight.emptyText')} />`
      : html`<div class="list">${all.slice().reverse().slice(0, 20).map((w) => html`<button class="li" onClick=${() => openWeightEntry(w.date)}>
          <span class="grow label">${fmtDate(w.date, 'short')}</span><span class="value">${kg(w.kg)} kg</span></button>`)}</div>`}
    <p class="tiny faint mt-12">${t('weight.tip')}</p>`;
}

function WeightForm({ date, close }) {
  const { date: today } = useClock();
  const [d, setD] = useState(date);
  const existing = store.find('weights', { date: d });
  const [v, setV] = useState(existing ? String(Number(existing.kg)) : '');
  const [err, setErr] = useState('');
  const options = Array.from({ length: 14 }, (_, i) => addDays(today, -i));
  if (!options.includes(d)) options.push(d);

  function save() {
    const n = num(v);
    if (!(n >= 20 && n <= 400)) return setErr(t('validate.range', { min: 20, max: 400 }));
    store.put('weights', { date: d, kg: Math.round(n * 100) / 100 });
    // Keep the body profile current for calorie suggestions.
    if (d === today) store.saveSettings({ body: { weight: Math.round(n * 10) / 10 } });
    haptic();
    toast(t('common.saved'));
    close(true);
  }
  async function del() {
    if (!(await confirmDialog({ title: t('weight.delete'), ok: t('common.delete'), danger: true }))) return;
    store.remove('weights', { date: d });
    close(true);
  }
  return html`<${SheetFrame} title=${t('weight.log')} close=${close}
    footer=${html`<div class="btn-row">${existing && html`<button class="btn danger" onClick=${del}>${t('common.delete')}</button>`}<button class="btn primary" onClick=${save}>${t('common.save')}</button></div>`}>
    <label class="field"><span>${t('common.date')}</span>
      <select value=${d} onChange=${(e) => { const nd = e.currentTarget.value; setD(nd); const ex = store.find('weights', { date: nd }); setV(ex ? String(Number(ex.kg)) : ''); setErr(''); }}>
        ${options.map((o) => html`<option value=${o}>${o === today ? t('common.today') : fmtDate(o, 'short')}</option>`)}
      </select></label>
    <${Field} label="kg" error=${err}><input inputmode="decimal" value=${v} placeholder="72.5" onInput=${(e) => { setV(e.currentTarget.value); setErr(''); }} /></${Field}>
  </${SheetFrame}>`;
}

export const openWeightEntry = (date) => openSheet(({ close }) => html`<${WeightForm} date=${date} close=${close} />`);
