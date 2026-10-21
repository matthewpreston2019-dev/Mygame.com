// =============================================================================
// Sleep: a simple "when did I sleep / wake" log, bedtime target, and a weekly
// consistency score (see sleepScore in shared/stats.js for the formula).
// =============================================================================

import { html, useState } from '../../lib/preact.js';
import * as store from '../../lib/store.js';
import { t, fmtDate, fmtDuration, fmtClock, ltr } from '../../lib/i18n.js';
import { useClock } from '../../lib/clock.js';
import { addDays, dateRange, toMinutes, zonedTimeToDate, isHHMM, zonedParts } from '../../shared/time.js';
import { Ring, BarChart, SheetFrame, Field, Empty, confirmDialog } from '../../components/common.js';
import { Icon } from '../../components/icons.js';
import { openSheet, toast, haptic } from '../../lib/ui.js';

export function SleepSection() {
  const { date: today, tz } = useClock();
  const s = store.settings();
  const stats = store.stats();
  const score = stats.sleepScore(today);
  const targetMin = ((toMinutes(s.schedule.wakeAt) - toMinutes(s.schedule.lightsOut)) + 1440) % 1440;
  const nights = dateRange(addDays(today, -6), today);
  const data = nights.map((d) => {
    const l = stats.day(d).sleep;
    return { label: fmtDate(d, 'narrow'), value: l ? Math.round((Date.parse(l.woke_at) - Date.parse(l.slept_at)) / 60000) : 0, highlight: d === today };
  });
  const logs = store.rows('sleep_logs').slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  const todayLog = stats.day(today).sleep;

  const verdict = score.score == null ? null : score.score >= 85 ? t('sleep.v1') : score.score >= 70 ? t('sleep.v2') : score.score >= 50 ? t('sleep.v3') : t('sleep.v4');

  return html`
    <div class="card accent">
      <div class="row" style="gap:16px">
        <${Ring} value=${(score.score || 0) / 100} size=${96} stroke=${9} color="var(--gold)">
          <div><div class="bold tnum" style="font-size:24px">${score.score ?? '–'}</div><div class="tiny faint">/100</div></div>
        </${Ring}>
        <div class="grow">
          <div class="bold">${t('sleep.score')}</div>
          ${score.score == null
            ? html`<div class="small muted mt-4">${t('sleep.needMore', { n: score.nights })}</div>`
            : html`<div class="small muted mt-4">${verdict}</div>
                <div class="small mt-8">${t('sleep.avgBed', { time: ltr(score.avgBed) })} · ${t('sleep.target', { time: ltr(s.schedule.lightsOut) })}</div>`}
        </div>
      </div>
      ${score.score != null && html`<div class="stats mt-16">
        <div class="stat"><div class="v">${fmtDuration(score.avgDurationMin)}</div><div class="l">${t('sleep.avgDuration')}</div></div>
        <div class="stat"><div class="v">${score.onTimeNights}/${score.nights}</div><div class="l">${t('sleep.onTime')}</div></div>
        <div class="stat"><div class="v">±${score.variationMin}<small>min</small></div><div class="l">${t('sleep.variation')}</div></div>
        <div class="stat"><div class="v">${score.avgWake}</div><div class="l">${t('sleep.avgWake')}</div></div>
      </div>`}
    </div>

    <button class="btn primary block mt-12" onClick=${() => openSleepLog(today)}><${Icon} name="bed" />${todayLog ? t('sleep.editLastNight') : t('sleep.logLastNight')}</button>

    <div class="section-title">${t('sleep.last7')}</div>
    <div class="card">
      <${BarChart} data=${data} goal=${targetMin} formatValue=${(v) => `${Math.round(v / 6) / 10}h`} />
      <p class="tiny faint mt-8">${t('sleep.goalLine', { d: fmtDuration(targetMin), bed: s.schedule.lightsOut, wake: s.schedule.wakeAt })}</p>
    </div>
    <p class="small muted mt-12">${t('sleep.explain')}</p>

    <div class="section-title">${t('sleep.log')}</div>
    ${logs.length === 0
      ? html`<${Empty} emoji="😴" title=${t('sleep.emptyTitle')} text=${t('sleep.emptyText')} />`
      : html`<div class="list">${logs.map((l) => html`<button class="li" onClick=${() => openSleepLog(l.date)}>
          <span class="grow"><div class="label">${fmtDate(l.date, 'short')}</div>
            <div class="sub">${ltr(`${fmtClock(l.slept_at, tz)} → ${fmtClock(l.woke_at, tz)}`)}</div></span>
          <span class="value">${fmtDuration((Date.parse(l.woke_at) - Date.parse(l.slept_at)) / 60000)}</span></button>`)}</div>`}`;
}

function SleepForm({ date, close }) {
  const { date: today } = useClock();
  const s = store.settings();
  const tz = s.timezone;
  const [d, setD] = useState(date);
  const init = (dd) => {
    const ex = store.find('sleep_logs', { date: dd });
    const hm = (iso) => { const p = zonedParts(new Date(iso), tz); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
    return ex ? { bed: hm(ex.slept_at), wake: hm(ex.woke_at) } : { bed: s.schedule.lightsOut, wake: s.schedule.wakeAt };
  };
  const [f, setF] = useState(() => init(date));
  const [err, setErr] = useState('');
  const existing = store.find('sleep_logs', { date: d });
  const options = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  // Editing an older night from the log: keep its date in the list so it shows.
  if (!options.includes(d)) options.push(d);

  // Bedtime later in the clock than wake-up (23:10 vs 07:00) means the evening before.
  function compute() {
    if (!isHHMM(f.bed) || !isHHMM(f.wake)) return null;
    const bedDate = toMinutes(f.bed) > toMinutes(f.wake) ? addDays(d, -1) : d;
    const slept = zonedTimeToDate(bedDate, f.bed, tz);
    const woke = zonedTimeToDate(d, f.wake, tz);
    return { slept, woke, min: (woke - slept) / 60000 };
  }
  const c = compute();

  function save() {
    if (!c) return setErr(t('validate.time'));
    if (c.min < 60 || c.min > 16 * 60) return setErr(t('sleep.badDuration'));
    if (c.woke.getTime() > Date.now() + 5 * 60000) return setErr(t('sleep.future'));
    store.put('sleep_logs', { date: d, slept_at: c.slept.toISOString(), woke_at: c.woke.toISOString() });
    haptic();
    toast(t('sleep.saved', { d: fmtDuration(c.min) }));
    close(true);
  }
  async function del() {
    if (!(await confirmDialog({ title: t('sleep.delete'), ok: t('common.delete'), danger: true }))) return;
    store.remove('sleep_logs', { date: d });
    close(true);
  }

  return html`<${SheetFrame} title=${t('sleep.howDidYouSleep')} close=${close}
    footer=${html`<div class="btn-row">${existing && html`<button class="btn danger" onClick=${del}>${t('common.delete')}</button>`}<button class="btn primary" onClick=${save}>${t('common.save')}</button></div>`}>
    <label class="field"><span>${t('sleep.wokeOn')}</span>
      <select value=${d} onChange=${(e) => { const nd = e.currentTarget.value; setD(nd); setF(init(nd)); setErr(''); }}>
        ${options.map((o) => html`<option value=${o}>${o === today ? t('common.today') : fmtDate(o, 'short')}</option>`)}
      </select></label>
    <div class="grid-2">
      <${Field} label=${t('sleep.wentToBed')}><input type="time" value=${f.bed} onInput=${(e) => { setF({ ...f, bed: e.currentTarget.value }); setErr(''); }} /></${Field}>
      <${Field} label=${t('sleep.wokeUp')}><input type="time" value=${f.wake} onInput=${(e) => { setF({ ...f, wake: e.currentTarget.value }); setErr(''); }} /></${Field}>
    </div>
    ${c && c.min > 0 && html`<div class="card center"><div class="small muted">${t('sleep.duration')}</div><div class="bold" style="font-size:22px">${fmtDuration(c.min)}</div></div>`}
    ${err && html`<div class="banner danger mt-12"><${Icon} name="info" /><span class="grow">${err}</span></div>`}
  </${SheetFrame}>`;
}

export const openSleepLog = (date) => openSheet(({ close }) => html`<${SleepForm} date=${date} close=${close} />`);
