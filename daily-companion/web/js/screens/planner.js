// =============================================================================
// Day planner ("tomorrow planner"): mark exams or changes for any day.
// Saved as a day_plans row; the plan, calendar and coach messages adapt
// automatically (exam prep the day before, lighter study after, gym moved…).
// =============================================================================

import { html, useState } from '../lib/preact.js';
import * as store from '../lib/store.js';
import { t, fmtDate, fmtDuration, getLang } from '../lib/i18n.js';
import { isHHMM, weekdayOf, addDays } from '../shared/time.js';
import { blockName, splitName } from '../shared/names.js';
import { SheetFrame, Seg, Field, Toggle } from '../components/common.js';
import { Icon } from '../components/icons.js';
import { openSheet, toast } from '../lib/ui.js';

export function dayTypeLabel(type) {
  return { short: t('dayType.short'), long: t('dayType.long'), weekend: t('dayType.free'), rest: t('dayType.rest') }[type] || type;
}

function DayPlanner({ date, close }) {
  const s = store.settings();
  const existing = store.find('day_plans', { date });
  const defaultType = s.schedule.days?.[weekdayOf(date)] || 'weekend';
  const [f, setF] = useState({
    day_type: existing?.day_type || '',
    free_from: existing?.free_from || '',
    hasExam: !!existing?.exam,
    examSubject: existing?.exam?.subject || '',
    examTime: existing?.exam?.time || '',
    skip_gym: !!existing?.skip_gym,
    skip_study: !!existing?.skip_study,
    note: existing?.note || '',
  });
  const [errors, setErrors] = useState({});
  const set = (k, v) => setF({ ...f, [k]: v });

  // Live preview of the resulting plan (see PlanPreview below).
  const draft = toRow(f);
  const effType = f.day_type || defaultType;

  function toRow(x) {
    return {
      date,
      day_type: x.day_type || null,
      free_from: x.free_from && isHHMM(x.free_from) ? x.free_from : null,
      exam: x.hasExam ? { subject: x.examSubject.trim().slice(0, 60), time: isHHMM(x.examTime) ? x.examTime : null } : null,
      skip_gym: x.skip_gym,
      skip_study: x.skip_study,
      note: x.note.trim().slice(0, 300) || null,
    };
  }

  function save() {
    const e = {};
    if (f.free_from && !isHHMM(f.free_from)) e.free_from = t('validate.time');
    if (f.hasExam && f.examTime && !isHHMM(f.examTime)) e.examTime = t('validate.time');
    if (f.hasExam && !f.examSubject.trim() && !f.examTime) e.examSubject = t('planner.examNeedsInfo');
    if (f.note.length > 300) e.note = t('validate.tooLong', { n: 300 });
    setErrors(e);
    if (Object.keys(e).length) return;
    const row = toRow(f);
    const isDefault = !row.day_type && !row.free_from && !row.exam && !row.skip_gym && !row.skip_study && !row.note;
    if (isDefault) { if (existing) store.remove('day_plans', { date }); }
    else store.put('day_plans', row);
    toast(t('planner.saved'));
    close(true);
  }

  function reset() {
    if (existing) store.remove('day_plans', { date });
    toast(t('planner.reset'));
    close(true);
  }

  const typeOpts = [
    { value: '', label: t('planner.normal') },
    { value: 'short', label: t('dayType.short') },
    { value: 'long', label: t('dayType.long') },
    { value: 'weekend', label: t('dayType.free') },
    { value: 'rest', label: t('dayType.rest') },
  ];
  const showFree = effType === 'short' || effType === 'long';

  return html`<${SheetFrame} title=${fmtDate(date, 'long')} close=${close}
    footer=${html`<div class="btn-row">
      ${existing && html`<button class="btn" onClick=${reset}>${t('planner.resetBtn')}</button>`}
      <button class="btn primary" onClick=${save}>${t('common.save')}</button></div>`}>
    <p class="small muted mb-12">${t('planner.intro', { type: dayTypeLabel(defaultType) })}</p>

    <div class="field"><span class="field-label">${t('planner.dayType')}</span>
      <${Seg} value=${f.day_type} options=${typeOpts} onChange=${(v) => set('day_type', v)} /></div>
    <p class="tiny faint" style="margin:-6px 2px 12px">${t(`planner.typeHint.${effType}`)}</p>

    ${showFree && html`<${Field} label=${t('planner.freeFrom')} hint=${t('planner.freeFromHint', { time: s.schedule.freeFrom[effType] })} error=${errors.free_from}>
      <input type="time" value=${f.free_from} onInput=${(e) => set('free_from', e.currentTarget.value)} /></${Field}>`}

    <div class="list">
      <div class="li"><span class="li-icon" style="background:var(--danger-dim);color:var(--danger)">📝</span>
        <span class="grow label">${t('planner.exam')}</span>
        <${Toggle} label=${t('planner.exam')} checked=${f.hasExam} onChange=${(v) => set('hasExam', v)} /></div>
      <div class="li"><span class="li-icon">🏋️</span><span class="grow label">${t('planner.skipGym')}</span>
        <${Toggle} label=${t('planner.skipGym')} checked=${f.skip_gym} onChange=${(v) => set('skip_gym', v)} /></div>
      <div class="li"><span class="li-icon">📚</span><span class="grow label">${t('planner.skipStudy')}</span>
        <${Toggle} label=${t('planner.skipStudy')} checked=${f.skip_study} onChange=${(v) => set('skip_study', v)} /></div>
    </div>

    ${f.hasExam && html`<div class="grid-2 mt-12">
      <${Field} label=${t('planner.subject')} error=${errors.examSubject}><input value=${f.examSubject} maxlength="60" placeholder=${t('planner.subjectPlaceholder')} onInput=${(e) => set('examSubject', e.currentTarget.value)} /></${Field}>
      <${Field} label=${t('planner.examTime')} error=${errors.examTime}><input type="time" value=${f.examTime} onInput=${(e) => set('examTime', e.currentTarget.value)} /></${Field}>
    </div>
    <p class="tiny faint" style="margin-top:-6px">${t('planner.examHint')}</p>`}

    <${Field} label=${t('planner.note')} error=${errors.note}>
      <textarea maxlength="300" placeholder=${t('planner.notePlaceholder')} value=${f.note} onInput=${(e) => set('note', e.currentTarget.value)}></textarea></${Field}>

    <${PlanPreview} date=${date} row=${draft} />
  </${SheetFrame}>`;
}

/** Shows what the day will look like with these changes, before saving. */
function PlanPreview({ date, row }) {
  const lang = getLang();
  const templates = store.rows('workout_templates');
  const plan = store.previewPlan(date, row);
  const shown = plan.blocks.filter((b) => !['checkin', 'winddown', 'sleep'].includes(b.kind));
  return html`<div class="section-title">${t('planner.preview')}</div>
    <div class="card">
      ${shown.length === 0 && html`<p class="small muted">${t('planner.previewEmpty')}</p>`}
      ${shown.map((b) => html`<div class="row" style="padding:4px 0">
        <span class="tnum faint" style="width:48px">${b.start}</span>
        <span class="grow">${blockName(b, plan.type, lang)}${b.kind === 'gym' ? ` · ${splitName(b.split, templates, lang)}` : ''}${b.kind === 'study' ? ` · ${fmtDuration(b.minutes)}` : ''}${b.kind === 'exam' && b.subject ? ` · ${b.subject}` : ''}</span>
      </div>`)}
      ${plan.gymMoved && html`<p class="small" style="color:var(--gold)">${t('plan.gymMoved')}</p>`}
      ${plan.trimmed && !plan.gymMoved && html`<p class="small faint">${t('plan.trimmed')}</p>`}
      ${plan.examTomorrow && html`<p class="small" style="color:var(--danger)">${t('plan.examTomorrow', { subject: plan.examTomorrow.subject || t('plan.exam') })}</p>`}
    </div>`;
}

export const openDayPlanner = (date) => openSheet(({ close }) => html`<${DayPlanner} date=${date} close=${close} />`);
export { addDays };
