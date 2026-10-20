// Settings → Schedule: day types, after-school times, block order & lengths,
// gym days, weekend times and the evening routine.
import { html, useState } from '../../lib/preact.js';
import * as store from '../../lib/store.js';
import { t, fmtDate } from '../../lib/i18n.js';
import { isHHMM } from '../../shared/time.js';
import { templateName } from '../../shared/names.js';
import { SheetFrame, Seg, Field } from '../../components/common.js';
import { openSheet, toast } from '../../lib/ui.js';
import { num } from '../onboarding.js';

/** Weekdays in display order (Mon … Sun) as JS weekday numbers. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Localised weekday name for 0–6 (uses a known week: 2024-01-07 was a Sunday). */
export function weekdayLabel(wd, style = 'weekday') {
  return fmtDate(`2024-01-${String(7 + wd).padStart(2, '0')}`, style);
}

const ORDERS = [
  ['relax', 'gym', 'study'], ['relax', 'study', 'gym'], ['gym', 'relax', 'study'],
  ['gym', 'study', 'relax'], ['study', 'relax', 'gym'], ['study', 'gym', 'relax'],
];

function ScheduleSheet({ close }) {
  const s = store.settings().schedule;
  const templates = store.rows('workout_templates').slice().sort((a, b) => a.sort - b.sort);
  const [d, setD] = useState(() => JSON.parse(JSON.stringify(s)));
  const [errors, setErrors] = useState({});

  const set = (path, value) => {
    const next = JSON.parse(JSON.stringify(d));
    let o = next;
    for (const p of path.slice(0, -1)) o = o[p];
    o[path[path.length - 1]] = value;
    setD(next);
  };
  const timeField = (label, path) => {
    const key = path.join('.');
    const val = path.reduce((o, p) => o?.[p], d);
    return html`<${Field} label=${label} error=${errors[key]}>
      <input type="time" value=${val || ''} onInput=${(e) => set(path, e.currentTarget.value)} /></${Field}>`;
  };
  const minField = (label, path, max = 300) => {
    const key = path.join('.');
    const val = path.reduce((o, p) => o?.[p], d);
    return html`<${Field} label=${label} error=${errors[key]}>
      <input inputmode="numeric" value=${val ?? ''} onInput=${(e) => set(path, e.currentTarget.value)} data-max=${max} /></${Field}>`;
  };

  function save() {
    const e = {};
    const times = [['freeFrom', 'short'], ['freeFrom', 'long'], ['schoolStart'], ['weekendStudyAt'], ['weekendGymAt'], ['checkinAt'], ['windDownAt'], ['lightsOut'], ['wakeAt']];
    for (const p of times) if (!isHHMM(p.reduce((o, k) => o?.[k], d))) e[p.join('.')] = t('validate.time');
    const mins = [[['relaxMin', 'short'], 240], [['relaxMin', 'long'], 240], [['gymMin'], 240], [['afterGymMin'], 180],
      [['studyMin', 'short'], 600], [['studyMin', 'long'], 600], [['studyMin', 'weekend'], 600]];
    const out = JSON.parse(JSON.stringify(d));
    for (const [p, max] of mins) {
      const v = num(p.reduce((o, k) => o?.[k], d));
      if (!(Number.isInteger(v) && v >= 0 && v <= max)) e[p.join('.')] = t('validate.range', { min: 0, max });
      else { let o = out; for (const k of p.slice(0, -1)) o = o[k]; o[p[p.length - 1]] = v; }
    }
    if (!(num(d.gymMin) >= 15)) e.gymMin = t('validate.range', { min: 15, max: 240 });
    setErrors(e);
    if (Object.keys(e).length) { toast(t('validate.fix'), { type: 'error' }); return; }
    // Always write all 7 weekdays so removing a gym day really removes it.
    out.gymDays = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((wd) => [wd, d.gymDays?.[wd] || null]));
    out.days = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((wd) => [wd, d.days?.[wd] || 'weekend']));
    store.saveSettings({ schedule: out });
    toast(t('common.saved'));
    close();
  }

  const typeOpts = [{ value: 'short', label: t('dayType.short') }, { value: 'long', label: t('dayType.long') }, { value: 'weekend', label: t('dayType.free') }];
  const blockLabel = (k) => t(`block.${k}`);

  return html`<${SheetFrame} title=${t('settings.schedule')} close=${close}
    footer=${html`<button class="btn primary block" onClick=${save}>${t('common.save')}</button>`}>

    <div class="section-title" style="margin-top:4px">${t('schedule.dayTypes')}</div>
    <div class="list">
      ${WEEK_ORDER.map((wd) => html`<div class="li" style="flex-direction:column;align-items:stretch;gap:8px">
        <span class="label">${weekdayLabel(wd, 'weekdayLong')}</span>
        <${Seg} value=${d.days?.[wd] || 'weekend'} options=${typeOpts} onChange=${(v) => set(['days', wd], v)} />
      </div>`)}
    </div>
    <p class="tiny faint mt-8">${t('schedule.dayTypesHint')}</p>

    <div class="section-title">${t('schedule.afterSchool')}</div>
    <div class="grid-3">
      ${timeField(t('schedule.schoolStart'), ['schoolStart'])}
      ${timeField(t('schedule.shortFree'), ['freeFrom', 'short'])}
      ${timeField(t('schedule.longFree'), ['freeFrom', 'long'])}
    </div>
    <label class="field"><span>${t('schedule.order')}</span>
      <select value=${d.order.join(',')} onChange=${(e) => set(['order'], e.currentTarget.value.split(','))}>
        ${ORDERS.map((o) => html`<option value=${o.join(',')}>${o.map(blockLabel).join(' → ')}</option>`)}
      </select>
    </label>
    <div class="grid-2">
      ${minField(t('schedule.relaxShort'), ['relaxMin', 'short'])}
      ${minField(t('schedule.relaxLong'), ['relaxMin', 'long'])}
      ${minField(t('schedule.gymMin'), ['gymMin'])}
      ${minField(t('schedule.afterGymMin'), ['afterGymMin'])}
    </div>

    <div class="section-title">${t('schedule.studyGoals')}</div>
    <div class="grid-3">
      ${minField(t('dayType.short'), ['studyMin', 'short'], 600)}
      ${minField(t('dayType.long'), ['studyMin', 'long'], 600)}
      ${minField(t('dayType.free'), ['studyMin', 'weekend'], 600)}
    </div>
    <p class="tiny faint" style="margin-top:-6px">${t('schedule.minutesHint')}</p>

    <div class="section-title">${t('schedule.gymDays')}</div>
    <div class="list">
      ${WEEK_ORDER.map((wd) => html`<label class="li">
        <span class="grow label">${weekdayLabel(wd, 'weekdayLong')}</span>
        <select class="input" style="width:170px;min-height:40px;padding:8px 12px" value=${d.gymDays?.[wd] || ''}
          onChange=${(e) => set(['gymDays', wd], e.currentTarget.value || null)}>
          <option value="">${t('schedule.noGym')}</option>
          ${templates.map((tp) => html`<option value=${tp.key || tp.id}>${templateName(tp, store.settings().language)}</option>`)}
        </select>
      </label>`)}
    </div>

    <div class="section-title">${t('schedule.weekend')}</div>
    <div class="grid-2">
      ${timeField(t('schedule.weekendStudyAt'), ['weekendStudyAt'])}
      ${timeField(t('schedule.weekendGymAt'), ['weekendGymAt'])}
    </div>

    <div class="section-title">${t('schedule.evening')}</div>
    <div class="grid-2">
      ${timeField(t('schedule.checkinAt'), ['checkinAt'])}
      ${timeField(t('schedule.windDownAt'), ['windDownAt'])}
      ${timeField(t('schedule.lightsOut'), ['lightsOut'])}
      ${timeField(t('schedule.wakeAt'), ['wakeAt'])}
    </div>
  </${SheetFrame}>`;
}

export const openScheduleSheet = () => openSheet(({ close }) => html`<${ScheduleSheet} close=${close} />`);
