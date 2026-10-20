// Settings → Targets & body: calories, protein, steps, goal weight, and the
// body profile used to suggest calorie/protein targets.
import { html, useState } from '../../lib/preact.js';
import * as store from '../../lib/store.js';
import { t, fmtNum } from '../../lib/i18n.js';
import { suggestTargets } from '../../shared/defaults.js';
import { SheetFrame, Seg, Field } from '../../components/common.js';
import { openSheet, toast } from '../../lib/ui.js';
import { num } from '../onboarding.js';

function TargetsSheet({ close }) {
  const s = store.settings();
  const [f, setF] = useState({
    kcal: s.targets.kcal, protein: s.targets.protein, steps: s.targets.steps, goalWeight: s.targets.goalWeight,
    weight: s.body.weight ?? '', height: s.body.height ?? '', age: s.body.age ?? '', sex: s.body.sex || '',
    activity: String(s.body.activity ?? 1.55), deficit: s.body.deficit ?? 400,
  });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.currentTarget ? e.currentTarget.value : e });

  const sug = suggestTargets({ weight: num(f.weight), height: num(f.height), age: num(f.age), sex: f.sex, activity: num(f.activity), deficit: num(f.deficit) }, num(f.goalWeight));

  function save() {
    const e = {};
    const chk = (k, min, max, int = true) => {
      const v = num(f[k]);
      if (Number.isNaN(v) || v < min || v > max || (int && !Number.isInteger(v))) e[k] = t('validate.range', { min, max });
    };
    const opt = (k, min, max, int) => { if (String(f[k]).trim() !== '') chk(k, min, max, int); };
    chk('kcal', 1000, 6000); chk('protein', 30, 400); chk('steps', 1000, 50000); chk('goalWeight', 30, 300, false);
    opt('weight', 30, 300, false); opt('height', 120, 230); opt('age', 10, 100); chk('deficit', 0, 1000);
    setErrors(e);
    if (Object.keys(e).length) { toast(t('validate.fix'), { type: 'error' }); return; }
    const o = (k) => (String(f[k]).trim() === '' ? null : num(f[k]));
    store.saveSettings({
      targets: { kcal: num(f.kcal), protein: num(f.protein), steps: num(f.steps), goalWeight: num(f.goalWeight) },
      body: { weight: o('weight'), height: o('height'), age: o('age'), sex: f.sex || null, activity: num(f.activity), deficit: num(f.deficit) },
    });
    toast(t('common.saved'));
    close();
  }

  const input = (k, label, mode = 'numeric') => html`<${Field} label=${label} error=${errors[k]}>
    <input inputmode=${mode} value=${f[k]} onInput=${set(k)} /></${Field}>`;

  return html`<${SheetFrame} title=${t('settings.targets')} close=${close}
    footer=${html`<button class="btn primary block" onClick=${save}>${t('common.save')}</button>`}>
    <div class="section-title" style="margin-top:4px">${t('targets.daily')}</div>
    <div class="grid-3">
      ${input('kcal', 'kcal')}
      ${input('protein', t('food.protein') + ' (g)')}
      ${input('steps', t('steps.title'))}
    </div>
    ${input('goalWeight', t('body.goalWeight') + ' (kg)', 'decimal')}

    <div class="section-title">${t('targets.body')}</div>
    <div class="grid-3">
      ${input('weight', t('body.weight') + ' (kg)', 'decimal')}
      ${input('height', t('body.height') + ' (cm)')}
      ${input('age', t('body.age'))}
    </div>
    <div class="field"><span class="field-label">${t('body.sex')}</span>
      <${Seg} value=${f.sex} onChange=${(v) => setF({ ...f, sex: v })} options=${[{ value: 'male', label: t('body.male') }, { value: 'female', label: t('body.female') }]} /></div>
    <label class="field"><span>${t('targets.activity')}</span>
      <select value=${f.activity} onChange=${set('activity')}>
        <option value="1.375">${t('targets.act1')}</option>
        <option value="1.55">${t('targets.act2')}</option>
        <option value="1.725">${t('targets.act3')}</option>
      </select></label>
    <label class="field"><span>${t('targets.pace')}</span>
      <select value=${String(f.deficit)} onChange=${set('deficit')}>
        <option value="0">${t('targets.pace0')}</option>
        <option value="250">${t('targets.pace1')}</option>
        <option value="400">${t('targets.pace2')}</option>
        <option value="600">${t('targets.pace3')}</option>
      </select></label>

    ${sug ? html`<div class="card gold">
        <div class="card-title"><h3>${t('targets.suggestion')}</h3></div>
        <p class="small muted">${t('onb.suggestionText', { maint: sug.maintenance, kcal: sug.kcal })}</p>
        <p class="bold mt-8">${fmtNum(sug.kcal)} kcal · ${sug.protein} g ${t('food.protein')}</p>
        <button class="btn small mt-12" onClick=${() => setF({ ...f, kcal: sug.kcal, protein: sug.protein })}>${t('targets.useSuggestion')}</button>
      </div>`
      : html`<p class="small faint">${t('targets.fillBody')}</p>`}
  </${SheetFrame}>`;
}

export const openTargetsSheet = () => openSheet(({ close }) => html`<${TargetsSheet} close=${close} />`);
