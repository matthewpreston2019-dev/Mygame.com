// Settings → Workout templates: edit the Upper/Lower split (exercises, sets,
// rep ranges, order) or add your own templates.
import { html, useState } from '../../lib/preact.js';
import * as store from '../../lib/store.js';
import { t, getLang } from '../../lib/i18n.js';
import { EXERCISES, exerciseName, templateName } from '../../shared/names.js';
import { SheetFrame, Field, confirmDialog } from '../../components/common.js';
import { Icon } from '../../components/icons.js';
import { openSheet, toast } from '../../lib/ui.js';
import { num } from '../onboarding.js';

function TemplatesSheet({ close }) {
  const list = store.rows('workout_templates').slice().sort((a, b) => a.sort - b.sort);
  const lang = getLang();
  return html`<${SheetFrame} title=${t('settings.templates')} close=${close}
    footer=${html`<button class="btn primary block" onClick=${() => openTemplateEditor(null)}><${Icon} name="plus" />${t('templates.add')}</button>`}>
    <div class="list">
      ${list.map((tp) => html`<button class="li" onClick=${() => openTemplateEditor(tp)}>
        <span class="li-icon"><${Icon} name="dumbbell" /></span>
        <span class="grow"><div class="label">${templateName(tp, lang)}</div>
          <div class="sub ellipsis">${(tp.exercises || []).map((e) => exerciseName(e, lang)).join(', ') || t('templates.empty')}</div></span>
        <${Icon} name="chev" class="chev" />
      </button>`)}
    </div>
  </${SheetFrame}>`;
}

function TemplateEditor({ tpl, close }) {
  const lang = getLang();
  const [name, setName] = useState(tpl ? templateName(tpl, lang) : '');
  const [exs, setExs] = useState(() => (tpl?.exercises || []).map((e) => ({ ...e, sets: String(e.sets), reps: e.reps })));
  const [errors, setErrors] = useState({});

  const update = (i, patch) => setExs(exs.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= exs.length) return;
    const next = exs.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setExs(next);
  };

  async function addExercise() {
    const ex = await openSheet(({ close: c }) => html`<${ExercisePicker} close=${c} existing=${exs.map((e) => e.id)} />`);
    if (ex) setExs([...exs, { ...ex, sets: '3', reps: '8-12' }]);
  }

  function save() {
    const e = {};
    const nm = name.trim();
    if (!nm) e.name = t('validate.required');
    if (nm.length > 40) e.name = t('validate.tooLong', { n: 40 });
    exs.forEach((x, i) => {
      const sets = num(x.sets);
      if (!(Number.isInteger(sets) && sets >= 1 && sets <= 10)) e[`sets${i}`] = '1–10';
      if (!String(x.reps || '').trim() || String(x.reps).length > 12) e[`reps${i}`] = t('validate.required');
    });
    setErrors(e);
    if (Object.keys(e).length) { toast(t('validate.fix'), { type: 'error' }); return; }
    const renamed = tpl?.key ? (nm !== templateName({ ...tpl, name: null }, lang) ? nm : null) : nm;
    const sortMax = Math.max(0, ...store.rows('workout_templates').map((x) => x.sort));
    store.put('workout_templates', {
      ...(tpl ? { id: tpl.id } : { sort: sortMax + 1 }),
      name: renamed,
      exercises: exs.map((x) => ({ id: x.id, ...(x.name ? { name: x.name } : {}), sets: num(x.sets), reps: String(x.reps).trim() })),
    });
    toast(t('common.saved'));
    close();
  }

  async function del() {
    const used = Object.values(store.settings().schedule.gymDays || {}).some((v) => v && (v === tpl.id || v === tpl.key));
    if (!(await confirmDialog({ title: t('templates.delete'), text: used ? t('templates.deleteUsed') : t('templates.deleteText'), ok: t('common.delete'), danger: true }))) return;
    store.remove('workout_templates', { id: tpl.id });
    if (used) {
      const gd = { ...store.settings().schedule.gymDays };
      for (const k of Object.keys(gd)) if (gd[k] === tpl.id || gd[k] === tpl.key) gd[k] = null;
      store.saveSettings({ schedule: { gymDays: gd } });
    }
    close();
  }

  return html`<${SheetFrame} title=${tpl ? t('templates.edit') : t('templates.add')} close=${close}
    footer=${html`<button class="btn primary block" onClick=${save}>${t('common.save')}</button>`}>
    <${Field} label=${t('templates.name')} error=${errors.name}>
      <input value=${name} maxlength="40" placeholder=${t('templates.namePlaceholder')} onInput=${(e) => setName(e.currentTarget.value)} /></${Field}>
    <div class="section-title">${t('templates.exercises')}</div>
    ${exs.length === 0 && html`<p class="muted small mb-12">${t('templates.empty')}</p>`}
    ${exs.map((x, i) => html`<div class="card" style="padding:12px">
      <div class="row">
        <div class="grow bold ellipsis">${exerciseName(x, lang)}</div>
        <button class="icon-btn plain" aria-label=${t('common.moveUp')} disabled=${i === 0} onClick=${() => move(i, -1)}><${Icon} name="up" /></button>
        <button class="icon-btn plain" aria-label=${t('common.moveDown')} disabled=${i === exs.length - 1} onClick=${() => move(i, 1)}><${Icon} name="down" /></button>
        <button class="icon-btn plain" aria-label=${t('common.delete')} onClick=${() => setExs(exs.filter((_, j) => j !== i))}><${Icon} name="trash" /></button>
      </div>
      <div class="grid-2 mt-8">
        <${Field} label=${t('workout.sets')} error=${errors[`sets${i}`]}><input inputmode="numeric" value=${x.sets} onInput=${(e) => update(i, { sets: e.currentTarget.value })} /></${Field}>
        <${Field} label=${t('workout.repRange')} error=${errors[`reps${i}`]}><input value=${x.reps} maxlength="12" onInput=${(e) => update(i, { reps: e.currentTarget.value })} placeholder="8-12" /></${Field}>
      </div>
    </div>`)}
    <button class="btn block mt-12" onClick=${addExercise}><${Icon} name="plus" />${t('templates.addExercise')}</button>
    ${tpl && html`<button class="btn danger block mt-16" onClick=${del}><${Icon} name="trash" />${t('templates.delete')}</button>`}
  </${SheetFrame}>`;
}

/** Choose a built-in exercise or type your own. Resolves { id, name? }. */
export function ExercisePicker({ close, existing = [] }) {
  const lang = getLang();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const matches = EXERCISES.filter((id) => !existing.includes(id) && (!query || exerciseName(id, lang).toLowerCase().includes(query) || exerciseName(id, 'en').toLowerCase().includes(query)));
  const custom = q.trim();
  return html`<${SheetFrame} title=${t('templates.addExercise')} close=${() => close()}>
    <input class="input mb-12" placeholder=${t('templates.searchOrType')} value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
    ${custom && !matches.some((id) => exerciseName(id, lang).toLowerCase() === query) && html`
      <button class="btn block mb-12" onClick=${() => close({ id: 'c:' + custom.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40), name: custom.slice(0, 40) })}>
        <${Icon} name="plus" />${t('templates.addCustom', { name: custom.slice(0, 40) })}</button>`}
    <div class="list">
      ${matches.map((id) => html`<button class="li" onClick=${() => close({ id })}><span class="grow label">${exerciseName(id, lang)}</span><${Icon} name="plus" class="chev" /></button>`)}
    </div>
  </${SheetFrame}>`;
}

const openTemplateEditor = (tpl) => openSheet(({ close }) => html`<${TemplateEditor} tpl=${tpl} close=${close} />`);
export const openTemplatesSheet = () => openSheet(({ close }) => html`<${TemplatesSheet} close=${close} />`);
