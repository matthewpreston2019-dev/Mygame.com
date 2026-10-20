// =============================================================================
// Study: timer (keeps running if you close the app), manual entry, today vs
// the day's goal (2 h short days, ~45 min long days…), weekly chart, sessions.
// =============================================================================

import { html, useEffect, useState } from '../../lib/preact.js';
import * as store from '../../lib/store.js';
import { t, fmtDate, fmtDuration, fmtClock } from '../../lib/i18n.js';
import { useClock } from '../../lib/clock.js';
import { addDays, weekStart, dateRange } from '../../shared/time.js';
import { Bar, BarChart, SheetFrame, Field, Empty, confirmDialog } from '../../components/common.js';
import { Icon } from '../../components/icons.js';
import { openSheet, toast, haptic } from '../../lib/ui.js';
import { getTimer, startTimer, stopTimer, discardTimer, elapsedMin, onTimerChange } from '../../lib/study-timer.js';
import { num } from '../onboarding.js';

export function StudySection() {
  const { date: today, tz } = useClock();
  const stats = store.stats();
  const plan = stats.planFor(today);
  const day = stats.day(today);
  const ws = weekStart(today);
  const days = dateRange(ws, addDays(ws, 6));
  const data = days.map((d) => ({ label: fmtDate(d, 'narrow'), value: stats.day(d).studyMin, goal: stats.planFor(d).studyGoal, highlight: d === today }));
  const week = stats.week(ws, today);
  const sessions = store.rows('study_sessions').slice().sort((a, b) => b.date.localeCompare(a.date) || String(b.started_at || b.updated_at).localeCompare(String(a.started_at || a.updated_at))).slice(0, 15);

  return html`
    <${TimerCard} />
    <div class="card mt-12">
      <div class="row between">
        <div><div class="small muted">${t('common.today')}</div>
          <div class="bold" style="font-size:22px">${fmtDuration(day.studyMin)} <span class="small faint">/ ${plan.studyGoal ? fmtDuration(plan.studyGoal) : t('today.noGoal')}</span></div></div>
        <button class="btn small" onClick=${() => openStudyEntry(today)}><${Icon} name="plus" />${t('study.addManual')}</button>
      </div>
      ${plan.studyGoal > 0 && html`<div class="mt-12"><${Bar} value=${day.studyMin / plan.studyGoal} /></div>`}
      ${plan.studyFocus && html`<div class="small mt-8" style="color:var(--danger)">📝 ${t('plan.prepFor', { subject: plan.studyFocus })}</div>`}
    </div>

    <div class="section-title">${t('study.thisWeek')}</div>
    <div class="card">
      <${BarChart} data=${data} formatValue=${(v) => (v >= 60 ? `${Math.round(v / 6) / 10}h` : `${v}m`)} />
      <div class="row between mt-8 small muted">
        <span>${fmtDuration(week.study.minutes)} / ${fmtDuration(week.study.goal)}</span>
        <span>${t('study.daysHit', { n: week.study.daysHit, total: week.study.daysPlanned })}</span>
      </div>
    </div>

    <div class="section-title">${t('study.sessions')}</div>
    ${sessions.length === 0
      ? html`<${Empty} emoji="📚" title=${t('study.emptyTitle')} text=${t('study.emptyText')} />`
      : html`<div class="list">${sessions.map((x) => html`<button class="li" onClick=${() => openStudyEntry(x.date, x)}>
          <span class="grow"><div class="label">${x.subject || t('study.session')}</div>
            <div class="sub">${fmtDate(x.date, 'short')}${x.started_at ? ` · ${fmtClock(x.started_at, tz)}` : ''} · ${t(`study.src.${x.source}`)}</div></span>
          <span class="value">${fmtDuration(x.minutes)}</span></button>`)}</div>`}`;
}

function TimerCard() {
  const [, tick] = useState(0);
  const [subject, setSubject] = useState('');
  useEffect(() => onTimerChange(() => tick((x) => x + 1)), []);
  const timer = getTimer();
  useEffect(() => {
    if (!timer) return;
    const iv = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, [!!timer]);

  if (!timer) {
    return html`<div class="card accent">
      <div class="bold mb-8">⏱ ${t('study.timer')}</div>
      <div class="row">
        <input class="input grow" maxlength="60" placeholder=${t('study.subjectOptional')} value=${subject} onInput=${(e) => setSubject(e.currentTarget.value)} />
        <button class="btn primary" onClick=${() => { startTimer(subject.trim()); haptic(); }}><${Icon} name="play" />${t('study.start')}</button>
      </div>
    </div>`;
  }
  const sec = Math.floor(elapsedMin(timer) * 60);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return html`<div class="card gold">
    <div class="small muted">${t('study.running')}${timer.subject ? ` · ${timer.subject}` : ''}</div>
    <div class="bold tnum center" style="font-size:44px;letter-spacing:-0.02em;margin:6px 0">${hh ? `${hh}:` : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}</div>
    <div class="btn-row">
      <button class="btn" onClick=${async () => { if (await confirmDialog({ title: t('study.discard'), text: t('study.discardText'), ok: t('study.discard'), danger: true })) discardTimer(); }}>${t('study.discard')}</button>
      <button class="btn primary" onClick=${() => { const m = stopTimer(); if (m) { haptic(12); toast(t('study.saved', { d: fmtDuration(m) })); } }}><${Icon} name="stop" />${t('study.stopSave')}</button>
    </div>
  </div>`;
}

function StudyForm({ date, session, close }) {
  const { date: today } = useClock();
  const [f, setF] = useState({ date: session?.date || date, minutes: session ? String(session.minutes) : '', subject: session?.subject || '' });
  const [errors, setErrors] = useState({});
  const options = Array.from({ length: 14 }, (_, i) => addDays(today, -i));
  if (!options.includes(f.date)) options.push(f.date);

  function save() {
    const e = {};
    const m = num(f.minutes);
    if (!(Number.isInteger(m) && m >= 1 && m <= 960)) e.minutes = t('validate.range', { min: 1, max: 960 });
    if (f.subject.length > 60) e.subject = t('validate.tooLong', { n: 60 });
    setErrors(e);
    if (Object.keys(e).length) return;
    store.put('study_sessions', { ...(session ? { id: session.id } : { source: 'manual' }), date: f.date, minutes: m, subject: f.subject.trim() || null });
    haptic();
    toast(t('common.saved'));
    close(true);
  }
  async function del() {
    if (!(await confirmDialog({ title: t('study.delete'), ok: t('common.delete'), danger: true }))) return;
    store.remove('study_sessions', { id: session.id });
    close(true);
  }
  const quick = [15, 25, 30, 45, 60, 90, 120];
  return html`<${SheetFrame} title=${session ? t('study.edit') : t('study.addManual')} close=${close}
    footer=${html`<div class="btn-row">${session && html`<button class="btn danger" onClick=${del}>${t('common.delete')}</button>`}<button class="btn primary" onClick=${save}>${t('common.save')}</button></div>`}>
    <label class="field"><span>${t('common.date')}</span>
      <select value=${f.date} onChange=${(e) => setF({ ...f, date: e.currentTarget.value })}>
        ${options.map((o) => html`<option value=${o}>${o === today ? t('common.today') : fmtDate(o, 'short')}</option>`)}
      </select></label>
    <${Field} label=${t('study.minutes')} error=${errors.minutes}>
      <input inputmode="numeric" value=${f.minutes} placeholder="45" onInput=${(e) => setF({ ...f, minutes: e.currentTarget.value })} /></${Field}>
    <div class="chips mb-12">${quick.map((q) => html`<button class=${`chip ${String(q) === f.minutes ? 'active' : ''}`} onClick=${() => setF({ ...f, minutes: String(q) })}>${fmtDuration(q)}</button>`)}</div>
    <${Field} label=${t('study.subject')} error=${errors.subject}>
      <input maxlength="60" value=${f.subject} placeholder=${t('study.subjectOptional')} onInput=${(e) => setF({ ...f, subject: e.currentTarget.value })} /></${Field}>
  </${SheetFrame}>`;
}

export const openStudyEntry = (date, session) => openSheet(({ close }) => html`<${StudyForm} date=${date} session=${session} close=${close} />`);
