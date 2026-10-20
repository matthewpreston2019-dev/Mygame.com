// =============================================================================
// Calendar tab: day and week views of school, study, gym, exams (from your
// plan) plus your own events. Add/edit events, plan any day, export to .ics.
// =============================================================================

import { html, useEffect, useRef, useState } from '../lib/preact.js';
import * as store from '../lib/store.js';
import { t, fmtDate, getLang, ltr } from '../lib/i18n.js';
import { useClock } from '../lib/clock.js';
import { addDays, weekStart, dateRange, zonedParts, zonedTimeToDate, toMinutes, toHHMM, isHHMM, dateInTz } from '../shared/time.js';
import { blockName, splitName } from '../shared/names.js';
import { Seg, SheetFrame, Field, confirmDialog } from '../components/common.js';
import { Icon } from '../components/icons.js';
import { openSheet, toast } from '../lib/ui.js';
import { openDayPlanner, dayTypeLabel } from './planner.js';
import { buildIcs, shareIcs } from '../lib/ics.js';

const HOUR_PX = 52;
const KINDS = ['school', 'study', 'gym', 'exam', 'custom'];
const PLAN_KINDS = ['school', 'relax', 'gym', 'refuel', 'study', 'exam'];

/** Everything shown on a day: plan blocks + your events, as minutes in your time zone. */
function itemsFor(date, tz, lang, templates) {
  const plan = store.stats().planFor(date);
  const items = plan.blocks.filter((b) => PLAN_KINDS.includes(b.kind)).map((b) => ({
    plan: true, id: `plan-${b.id}`, kind: b.kind, start: b.startMin, end: Math.max(b.endMin, b.startMin + 15),
    title: blockName(b, plan.type, lang) + (b.kind === 'gym' ? ` · ${splitName(b.split, templates, lang)}` : b.kind === 'exam' && b.subject ? ` · ${b.subject}` : ''),
  }));
  for (const e of store.rows('events')) {
    const s = new Date(e.starts_at), en = new Date(e.ends_at);
    const sd = dateInTz(tz, s), ed = dateInTz(tz, en);
    if (date < sd || date > ed) continue;
    const sp = zonedParts(s, tz), ep = zonedParts(en, tz);
    const start = sd === date ? sp.hour * 60 + sp.minute : 0;
    const end = ed === date ? ep.hour * 60 + ep.minute : 1440;
    items.push({ plan: false, id: e.id, event: e, kind: e.kind, start, end: Math.max(end, start + 15), title: e.title });
  }
  return { plan, items: layout(items) };
}

/** Side-by-side columns for overlapping items. */
function layout(items) {
  items.sort((a, b) => a.start - b.start || b.end - a.end);
  let group = [], groupEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of group) {
      let c = cols.findIndex((end) => end <= it.start);
      if (c === -1) { c = cols.length; cols.push(0); }
      cols[c] = it.end;
      it.col = c;
    }
    for (const it of group) it.cols = cols.length;
  };
  for (const it of items) {
    if (it.start >= groupEnd && group.length) { flush(); group = []; }
    group.push(it);
    groupEnd = Math.max(groupEnd, it.end);
  }
  if (group.length) flush();
  return items;
}

export function CalendarScreen() {
  const { date: today, minutes, tz } = useClock();
  const [view, setView] = useState('day');
  const [sel, setSel] = useState(today);
  const lang = getLang();
  const templates = store.rows('workout_templates');
  const ws = weekStart(sel);
  const week = dateRange(ws, addDays(ws, 6));

  return html`<div class="screen">
    <div class="screen-head">
      <div class="grow"><h1 class="title">${t('tabs.calendar')}</h1><p class="subtitle">${fmtDate(sel, 'month')}</p></div>
      <button class="icon-btn" aria-label=${t('calendar.export')} onClick=${() => openExport(today)}><${Icon} name="share" /></button>
      <button class="icon-btn gold" aria-label=${t('calendar.addEvent')} onClick=${() => openEventForm({ date: sel })}><${Icon} name="plus" /></button>
    </div>
    <${Seg} value=${view} onChange=${setView} options=${[{ value: 'day', label: t('calendar.day') }, { value: 'week', label: t('calendar.week') }]} />

    <div class="cal-nav mt-12">
      <button class="icon-btn" aria-label=${t('common.previous')} onClick=${() => setSel(addDays(sel, view === 'week' ? -7 : -1))}><${Icon} name="back" class="flip" /></button>
      <button class="grow" style="border:0;background:none;color:inherit;font:inherit;font-weight:700" onClick=${() => setSel(today)}>
        ${view === 'week' ? `${fmtDate(ws, 'dayMonth')} – ${fmtDate(addDays(ws, 6), 'dayMonth')}` : sel === today ? t('common.today') : fmtDate(sel, 'long')}
      </button>
      <button class="icon-btn" aria-label=${t('common.next')} onClick=${() => setSel(addDays(sel, view === 'week' ? 7 : 1))}><${Icon} name="chev" class="flip" /></button>
    </div>

    ${view === 'day'
      ? html`<${WeekStrip} week=${week} sel=${sel} today=${today} onPick=${setSel} tz=${tz} lang=${lang} templates=${templates} />
             <${DayView} date=${sel} today=${today} minutes=${minutes} tz=${tz} lang=${lang} templates=${templates} />`
      : html`<${WeekView} week=${week} today=${today} tz=${tz} lang=${lang} templates=${templates} onPick=${(d) => { setSel(d); setView('day'); }} />`}
  </div>`;
}

function WeekStrip({ week, sel, today, onPick, tz, lang, templates }) {
  return html`<div class="week-strip">
    ${week.map((d) => {
      const { plan, items } = itemsFor(d, tz, lang, templates);
      const dots = [];
      if (plan.exam || items.some((i) => i.kind === 'exam')) dots.push('exam');
      if (plan.gym) dots.push('gym');
      if (items.some((i) => !i.plan && i.kind !== 'exam')) dots.push('ev');
      return html`<button class=${`${d === sel ? 'sel' : ''} ${d === today ? 'today' : ''}`} onClick=${() => onPick(d)} aria-pressed=${d === sel}>
        ${fmtDate(d, 'weekday')}<b>${Number(d.slice(8))}</b>
        <span class="dots">${dots.map((k) => html`<i class=${k === 'exam' ? 'exam' : ''}></i>`)}</span>
      </button>`;
    })}
  </div>`;
}

function DayView({ date, today, minutes, tz, lang, templates }) {
  const { plan, items } = itemsFor(date, tz, lang, templates);
  const startH = Math.min(7, ...items.map((i) => Math.floor(i.start / 60)));
  const endH = Math.max(23, ...items.map((i) => Math.ceil(i.end / 60)));
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
  const ref = useRef(null);
  // Scroll the current time into view on today.
  useEffect(() => {
    if (date === today && ref.current) {
      const y = ref.current.getBoundingClientRect().top + scrollY + ((minutes - startH * 60) / 60) * HOUR_PX - 160;
      if (y > scrollY + 100) scrollTo({ top: y, behavior: 'smooth' });
    }
  }, [date]);

  return html`
    <button class="card" style="width:100%;text-align:start;color:inherit;display:block;padding:12px 14px;margin-bottom:12px" onClick=${() => openDayPlanner(date)}>
      <div class="row">
        <span class="badge ${plan.overridden ? 'gold' : 'sage'}">${dayTypeLabel(plan.type)}</span>
        <span class="grow small muted ellipsis">${[plan.freeFrom && t('today.freeFrom', { time: plan.freeFrom }), plan.exam && `📝 ${plan.exam.subject || t('plan.exam')}`, plan.note].filter(Boolean).join(' · ')}</span>
        <span class="link-btn">${t('calendar.planDay')}</span>
      </div>
    </button>
    <div class="dayview" ref=${ref} style=${`height:${hours.length * HOUR_PX}px`}>
      ${hours.map((h) => html`<div class="hour"><span class="h">${String(h).padStart(2, '0')}:00</span><span class="slot"></span></div>`)}
      ${items.map((it) => {
        const top = ((it.start - startH * 60) / 60) * HOUR_PX;
        const height = Math.max(22, ((it.end - it.start) / 60) * HOUR_PX - 2);
        const w = `calc((100% - 52px) / ${it.cols})`;
        return html`<button class=${`ev k-${it.kind} ${it.plan ? 'plan' : ''}`}
          style=${`top:${top}px;height:${height}px;width:${w};inset-inline-start:calc(50px + (100% - 52px) / ${it.cols} * ${it.col})`}
          onClick=${() => (it.plan ? openDayPlanner(date) : openEventForm({ event: it.event }))}>
          <b class="ellipsis">${it.title}</b>
          ${height > 34 && html`<span class="tm">${ltr(`${toHHMM(it.start)}–${toHHMM(it.end % 1440)}`)}</span>`}
        </button>`;
      })}
      ${date === today && minutes >= startH * 60 && minutes <= endH * 60 && html`<div class="now-line" style=${`top:${((minutes - startH * 60) / 60) * HOUR_PX}px`}></div>`}
    </div>`;
}

function WeekView({ week, today, tz, lang, templates, onPick }) {
  const START = 7, END = 23, PX = 30;
  const cols = week.map((d) => itemsFor(d, tz, lang, templates).items);
  return html`<div class="card" style="padding:10px 6px 10px 4px">
    <div class="weekgrid">
      <div></div>
      ${week.map((d) => html`<button class=${`wh ${d === today ? 'today' : ''}`} style="border:0;background:none" onClick=${() => onPick(d)}>${fmtDate(d, 'narrow')}<br /><b>${Number(d.slice(8))}</b></button>`)}
      <div class="tcol" style=${`height:${(END - START) * PX}px`}>
        ${Array.from({ length: END - START }, (_, i) => html`<span class="h" style=${`top:${i * PX}px`}>${START + i}</span>`)}
      </div>
      ${cols.map((items, i) => html`<div class="dcol" style=${`height:${(END - START) * PX}px`}>
        ${Array.from({ length: END - START }, (_, h) => html`<span class="hl" style=${`top:${h * PX}px`}></span>`)}
        ${items.filter((it) => it.end > START * 60 && it.start < END * 60).map((it) => {
          const s = Math.max(it.start, START * 60), e = Math.min(it.end, END * 60);
          return html`<button class=${`wev k-${it.kind}`} onClick=${() => onPick(week[i])}
            style=${`top:${((s - START * 60) / 60) * PX}px;height:${Math.max(12, ((e - s) / 60) * PX - 1)}px;inset-inline-start:${(it.col / it.cols) * 100}%;width:${100 / it.cols}%`}>${it.title}</button>`;
        })}
      </div>`)}
    </div>
  </div>
  <p class="tiny faint mt-8 center">${t('calendar.tapDay')}</p>`;
}

// ---- Event form ------------------------------------------------------------------

function EventForm({ event, date, close }) {
  const tz = store.settings().timezone;
  const hm = (iso) => { const p = zonedParts(new Date(iso), tz); return toHHMM(p.hour * 60 + p.minute); };
  const [f, setF] = useState({
    title: event?.title || '',
    kind: event?.kind || 'custom',
    date: event ? dateInTz(tz, new Date(event.starts_at)) : date,
    start: event ? hm(event.starts_at) : '16:00',
    end: event ? hm(event.ends_at) : '17:00',
    notes: event?.notes || '',
  });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.currentTarget.value });

  function save() {
    const e = {};
    const title = f.title.trim();
    if (!title) e.title = t('validate.required');
    if (title.length > 80) e.title = t('validate.tooLong', { n: 80 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) e.date = t('validate.required');
    if (!isHHMM(f.start)) e.start = t('validate.time');
    if (!isHHMM(f.end)) e.end = t('validate.time');
    if (!e.start && !e.end && toMinutes(f.end) <= toMinutes(f.start)) e.end = t('calendar.endAfterStart');
    if (f.notes.length > 500) e.notes = t('validate.tooLong', { n: 500 });
    setErrors(e);
    if (Object.keys(e).length) return;
    const row = store.put('events', {
      ...(event ? { id: event.id } : {}),
      title, kind: f.kind, notes: f.notes.trim() || null,
      starts_at: zonedTimeToDate(f.date, f.start, tz).toISOString(),
      ends_at: zonedTimeToDate(f.date, f.end, tz).toISOString(),
    });
    // An exam in the calendar also adapts your plan (prep the day before, lighter after).
    if (f.kind === 'exam') {
      const dp = store.find('day_plans', { date: f.date });
      store.put('day_plans', { date: f.date, ...(dp || { skip_gym: false, skip_study: false }), exam: { subject: title, time: f.start } });
    }
    if (event && event.kind === 'exam') cleanupExam(event, f.kind === 'exam' ? f.date : null, tz);
    void row;
    toast(t('common.saved'));
    close(true);
  }

  async function del() {
    if (!(await confirmDialog({ title: t('calendar.deleteEvent'), text: event.title, ok: t('common.delete'), danger: true }))) return;
    store.remove('events', { id: event.id });
    if (event.kind === 'exam') cleanupExam(event, null, tz);
    close(true);
  }

  return html`<${SheetFrame} title=${event ? t('calendar.editEvent') : t('calendar.addEvent')} close=${close}
    footer=${html`<div class="btn-row">${event && html`<button class="btn danger" onClick=${del}>${t('common.delete')}</button>`}<button class="btn primary" onClick=${save}>${t('common.save')}</button></div>`}>
    <${Field} label=${t('calendar.title')} error=${errors.title}><input value=${f.title} maxlength="80" onInput=${set('title')} placeholder=${t('calendar.titlePlaceholder')} /></${Field}>
    <div class="chips mb-12">${KINDS.map((k) => html`<button class=${`chip ${f.kind === k ? 'active' : ''}`} onClick=${() => setF({ ...f, kind: k })}>${t(`calendar.kind.${k}`)}</button>`)}</div>
    <${Field} label=${t('common.date')} error=${errors.date}><input type="date" value=${f.date} onInput=${set('date')} /></${Field}>
    <div class="grid-2">
      <${Field} label=${t('calendar.start')} error=${errors.start}><input type="time" value=${f.start} onInput=${set('start')} /></${Field}>
      <${Field} label=${t('calendar.end')} error=${errors.end}><input type="time" value=${f.end} onInput=${set('end')} /></${Field}>
    </div>
    ${f.kind === 'exam' && html`<p class="small muted" style="margin-top:-4px">${t('calendar.examAdapts')}</p>`}
    <${Field} label=${t('calendar.notes')} error=${errors.notes}><textarea maxlength="500" value=${f.notes} onInput=${set('notes')}></textarea></${Field}>
  </${SheetFrame}>`;
}

/** Remove the planner exam that came from this event (if it still matches). */
function cleanupExam(event, keepDate, tz) {
  const oldDate = dateInTz(tz, new Date(event.starts_at));
  if (oldDate === keepDate) return;
  const dp = store.find('day_plans', { date: oldDate });
  if (dp?.exam && dp.exam.subject === event.title) store.put('day_plans', { date: oldDate, exam: null });
}

export const openEventForm = ({ event, date }) => openSheet(({ close }) => html`<${EventForm} event=${event} date=${date} close=${close} />`);

// ---- Export ------------------------------------------------------------------------

function ExportSheet({ today, close }) {
  const [weeks, setWeeks] = useState(4);
  const [withPlan, setWithPlan] = useState(true);
  const [busy, setBusy] = useState(false);
  const s = store.settings();
  const lang = getLang();
  const templates = store.rows('workout_templates');

  async function go() {
    setBusy(true);
    const from = today, to = addDays(today, weeks * 7 - 1);
    const tz = s.timezone;
    const out = [];
    for (const e of store.rows('events')) {
      const d = dateInTz(tz, new Date(e.starts_at));
      if (d < from || d > to) continue;
      out.push({ uid: e.id, title: e.title, start: new Date(e.starts_at), end: new Date(e.ends_at), description: e.notes, category: t(`calendar.kind.${e.kind}`) });
    }
    if (withPlan) {
      for (const d of dateRange(from, to)) {
        const plan = store.stats().planFor(d);
        for (const b of plan.blocks.filter((x) => ['gym', 'study', 'exam'].includes(x.kind))) {
          // Exams from calendar events are already included above.
          if (b.kind === 'exam' && out.some((x) => x.category === t('calendar.kind.exam') && dateInTz(tz, x.start) === d)) continue;
          const title = blockName(b, plan.type, lang) + (b.kind === 'gym' ? ` · ${splitName(b.split, templates, lang)}` : b.kind === 'exam' && b.subject ? ` · ${b.subject}` : '');
          out.push({ uid: `plan-${d}-${b.id}`, title, start: zonedTimeToDate(d, b.start, tz), end: zonedTimeToDate(d, b.end, tz), category: 'Daily Companion' });
        }
      }
    }
    if (!out.length) { toast(t('calendar.nothingToExport'), { type: 'info' }); setBusy(false); return; }
    const res = await shareIcs(buildIcs(out), `daily-companion-${from}.ics`);
    setBusy(false);
    if (res !== 'cancelled') { toast(t('calendar.exported', { n: out.length })); close(); }
  }

  return html`<${SheetFrame} title=${t('calendar.export')} close=${close}
    footer=${html`<button class="btn primary block" disabled=${busy} onClick=${go}><${Icon} name="share" />${t('calendar.exportBtn')}</button>`}>
    <p class="small muted mb-12">${t('calendar.exportText')}</p>
    <div class="field"><span class="field-label">${t('calendar.range')}</span>
      <${Seg} value=${weeks} onChange=${setWeeks} options=${[1, 2, 4, 8].map((w) => ({ value: w, label: t('calendar.weeksN', { n: w }) }))} /></div>
    <div class="li" style="padding:0 2px">
      <span class="grow label">${t('calendar.includePlan')}</span>
      <label class="switch"><input type="checkbox" checked=${withPlan} onChange=${(e) => setWithPlan(e.currentTarget.checked)} /><span class="track"></span><span class="knob"></span></label>
    </div>
  </${SheetFrame}>`;
}

const openExport = (today) => openSheet(({ close }) => html`<${ExportSheet} today=${today} close=${close} />`);
