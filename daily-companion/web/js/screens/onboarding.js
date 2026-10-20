// =============================================================================
// First-run setup: language → body & goals → your week → notifications.
// Everything here can be changed later in Profile → Settings.
// =============================================================================

import { html, useState } from '../lib/preact.js';
import * as store from '../lib/store.js';
import { t, setLanguage, getLang } from '../lib/i18n.js';
import { LANGUAGES, suggestTargets } from '../shared/defaults.js';
import { isHHMM } from '../shared/time.js';
import { Field, Seg } from '../components/common.js';
import { Icon } from '../components/icons.js';
import { enablePush, pushSupport } from '../lib/push.js';
import { toast } from '../lib/ui.js';
import { openInstallSheet } from './install-prompt.js';

const STEPS = ['language', 'body', 'week', 'notify'];

/** Parse a number typed by a person ("72,5" works too). Returns NaN if empty/invalid. */
export const num = (v) => (String(v ?? '').trim() === '' ? NaN : Number(String(v).replace(',', '.')));

export function Onboarding() {
  const s = store.settings();
  const [step, setStep] = useState(0);
  const [body, setBody] = useState({
    weight: s.body.weight ?? '', height: s.body.height ?? '', age: s.body.age ?? '', sex: s.body.sex ?? '',
    goalWeight: s.targets.goalWeight ?? 69,
  });
  const [targets, setTargets] = useState({ kcal: s.targets.kcal, protein: s.targets.protein, steps: s.targets.steps });
  const [touchedTargets, setTouchedTargets] = useState(false);
  const [week, setWeek] = useState({
    short: s.schedule.freeFrom.short, long: s.schedule.freeFrom.long, lightsOut: s.schedule.lightsOut,
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const suggestion = suggestTargets({ ...s.body, weight: num(body.weight), height: num(body.height), age: num(body.age), sex: body.sex }, num(body.goalWeight));
  // Fill in the suggestion until you edit the targets yourself.
  const shown = !touchedTargets && suggestion ? { ...targets, kcal: suggestion.kcal, protein: suggestion.protein } : targets;

  function validateBody() {
    const e = {};
    const w = num(body.weight), h = num(body.height), a = num(body.age), g = num(body.goalWeight);
    if (body.weight !== '' && !(w >= 30 && w <= 300)) e.weight = t('validate.range', { min: 30, max: 300 });
    if (body.height !== '' && !(h >= 120 && h <= 230)) e.height = t('validate.range', { min: 120, max: 230 });
    if (body.age !== '' && !(a >= 10 && a <= 100 && Number.isInteger(a))) e.age = t('validate.range', { min: 10, max: 100 });
    if (!(g >= 30 && g <= 300)) e.goalWeight = t('validate.range', { min: 30, max: 300 });
    if (!(shown.kcal >= 1000 && shown.kcal <= 6000)) e.kcal = t('validate.range', { min: 1000, max: 6000 });
    if (!(shown.protein >= 30 && shown.protein <= 400)) e.protein = t('validate.range', { min: 30, max: 400 });
    if (!(shown.steps >= 1000 && shown.steps <= 50000)) e.steps = t('validate.range', { min: 1000, max: 50000 });
    setErrors(e);
    return !Object.keys(e).length;
  }

  function validateWeek() {
    const e = {};
    for (const k of ['short', 'long', 'lightsOut']) if (!isHHMM(week[k])) e[k] = t('validate.time');
    setErrors(e);
    return !Object.keys(e).length;
  }

  function next() {
    const id = STEPS[step];
    if (id === 'body') {
      if (!validateBody()) return;
      const w = num(body.weight), h = num(body.height), a = num(body.age);
      store.saveSettings({
        body: { weight: Number.isNaN(w) ? null : w, height: Number.isNaN(h) ? null : h, age: Number.isNaN(a) ? null : a, sex: body.sex || null },
        targets: { goalWeight: num(body.goalWeight), kcal: Math.round(shown.kcal), protein: Math.round(shown.protein), steps: Math.round(shown.steps) },
      });
      // Also log today's weight so the trend starts now.
      if (!Number.isNaN(w)) {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: s.timezone }).format(new Date());
        store.put('weights', { date: today, kg: w });
      }
    }
    if (id === 'week') {
      if (!validateWeek()) return;
      store.saveSettings({ schedule: { freeFrom: { short: week.short, long: week.long }, lightsOut: week.lightsOut } });
    }
    setErrors({});
    setStep(step + 1);
    scrollTo(0, 0);
  }

  function finish() {
    store.saveSettings({ onboarded: true });
  }

  async function turnOnPush() {
    setBusy(true);
    try {
      const r = await enablePush();
      if (r === 'enabled') { toast(t('notify.enabled')); finish(); }
      else if (r === 'needs-install') openInstallSheet();
      else if (r === 'denied') toast(t('notify.denied'), { type: 'error', duration: 4500 });
      else if (r === 'offline') toast(t('common.offlineTryLater'), { type: 'error' });
      else toast(t('notify.unsupported'), { type: 'error' });
    } catch {
      toast(t('common.error'), { type: 'error' });
    } finally { setBusy(false); }
  }

  const id = STEPS[step];
  const dots = html`<div class="row" style="justify-content:center;gap:6px;margin:4px 0 18px">
    ${STEPS.map((_, i) => html`<span style=${`width:${i === step ? 22 : 7}px;height:7px;border-radius:4px;background:${i <= step ? 'var(--gold)' : 'var(--card-3)'};transition:all .3s`}></span>`)}
  </div>`;

  let content;
  if (id === 'language') {
    content = html`
      <h1 class="title">${t('onb.welcome')}</h1>
      <p class="subtitle mb-16">${t('onb.welcomeText')}</p>
      <div class="list">
        ${LANGUAGES.map((l) => html`<button class="li" onClick=${() => { setLanguage(l.code); store.saveSettings({ language: l.code }); }}>
          <span class="grow label">${l.name}</span>
          ${getLang() === l.code && html`<span style="color:var(--gold)"><${Icon} name="check" /></span>`}
        </button>`)}
      </div>`;
  } else if (id === 'body') {
    const set = (k) => (e) => setBody({ ...body, [k]: e.currentTarget.value });
    const setT = (k) => (e) => { setTouchedTargets(true); setTargets({ ...shown, [k]: num(e.currentTarget.value) }); };
    content = html`
      <h1 class="title">${t('onb.bodyTitle')}</h1>
      <p class="subtitle mb-16">${t('onb.bodyText')}</p>
      <div class="grid-2">
        <${Field} label=${t('body.weight')} error=${errors.weight}><input inputmode="decimal" value=${body.weight} onInput=${set('weight')} placeholder="kg" /></${Field}>
        <${Field} label=${t('body.goalWeight')} error=${errors.goalWeight}><input inputmode="decimal" value=${body.goalWeight} onInput=${set('goalWeight')} placeholder="kg" /></${Field}>
        <${Field} label=${t('body.height')} error=${errors.height}><input inputmode="numeric" value=${body.height} onInput=${set('height')} placeholder="cm" /></${Field}>
        <${Field} label=${t('body.age')} error=${errors.age}><input inputmode="numeric" value=${body.age} onInput=${set('age')} /></${Field}>
      </div>
      <div class="field"><span class="field-label">${t('body.sex')}</span>
        <${Seg} value=${body.sex} onChange=${(v) => setBody({ ...body, sex: v })}
          options=${[{ value: 'male', label: t('body.male') }, { value: 'female', label: t('body.female') }]} />
      </div>
      <div class=${`card ${suggestion ? 'gold' : ''} mt-16`}>
        <div class="card-title"><h3>${t('onb.targets')}</h3>${suggestion && !touchedTargets && html`<span class="badge gold">${t('onb.suggested')}</span>`}</div>
        ${suggestion && html`<p class="small muted mb-12">${t('onb.suggestionText', { maint: suggestion.maintenance, kcal: suggestion.kcal })}</p>`}
        <div class="grid-3">
          <${Field} label="kcal" error=${errors.kcal}><input inputmode="numeric" value=${Number.isNaN(shown.kcal) ? '' : shown.kcal} onInput=${setT('kcal')} /></${Field}>
          <${Field} label=${t('food.protein') + ' (g)'} error=${errors.protein}><input inputmode="numeric" value=${Number.isNaN(shown.protein) ? '' : shown.protein} onInput=${setT('protein')} /></${Field}>
          <${Field} label=${t('steps.title')} error=${errors.steps}><input inputmode="numeric" value=${Number.isNaN(shown.steps) ? '' : shown.steps} onInput=${setT('steps')} /></${Field}>
        </div>
        <p class="tiny faint">${t('onb.targetsNote')}</p>
      </div>`;
  } else if (id === 'week') {
    const set = (k) => (e) => setWeek({ ...week, [k]: e.currentTarget.value });
    content = html`
      <h1 class="title">${t('onb.weekTitle')}</h1>
      <p class="subtitle mb-16">${t('onb.weekText')}</p>
      <div class="list">
        <div class="li"><div class="li-icon">⚡</div><div class="grow"><div class="label">${t('schedule.shortDays')}</div><div class="sub">${t('onb.shortDesc')}</div></div></div>
        <div class="li"><div class="li-icon">🌙</div><div class="grow"><div class="label">${t('schedule.longDays')}</div><div class="sub">${t('onb.longDesc')}</div></div></div>
        <div class="li"><div class="li-icon">🏋️</div><div class="grow"><div class="label">${t('schedule.gym')}</div><div class="sub">${t('onb.gymDesc')}</div></div></div>
      </div>
      <div class="grid-3 mt-16">
        <${Field} label=${t('onb.shortFree')} error=${errors.short}><input type="time" value=${week.short} onInput=${set('short')} /></${Field}>
        <${Field} label=${t('onb.longFree')} error=${errors.long}><input type="time" value=${week.long} onInput=${set('long')} /></${Field}>
        <${Field} label=${t('schedule.lightsOut')} error=${errors.lightsOut}><input type="time" value=${week.lightsOut} onInput=${set('lightsOut')} /></${Field}>
      </div>
      <p class="small faint">${t('onb.weekMore')}</p>`;
  } else {
    const ps = pushSupport();
    content = html`
      <h1 class="title">${t('onb.notifyTitle')}</h1>
      <p class="subtitle mb-16">${t('onb.notifyText')}</p>
      <div class="card">
        ${[['📋', 'notify.plan'], ['📚', 'notify.study'], ['🏋️', 'notify.gym'], ['✅', 'notify.checkin'], ['🌙', 'notify.winddown'], ['📊', 'notify.weekly']].map(([e, k]) => html`
          <div class="row mb-8"><span style="width:26px;text-align:center">${e}</span><span>${t(k)}</span></div>`)}
      </div>
      ${ps.needsInstall && html`<div class="banner warn mt-12"><${Icon} name="info" /><span class="grow">${t('notify.installFirst')}</span></div>`}`;
  }

  const last = step === STEPS.length - 1;
  return html`<main class="app no-tabs"><div class="screen" key=${step}>
    ${dots}
    ${content}
    <div class="col mt-24">
      ${!last && html`<button class="btn primary block" onClick=${next}>${t('common.continue')}</button>`}
      ${last && html`<button class="btn primary block" disabled=${busy} onClick=${pushSupport().needsInstall ? openInstallSheet : turnOnPush}>
        <${Icon} name=${pushSupport().needsInstall ? 'download' : 'bell'} />${pushSupport().needsInstall ? t('install.title') : t('notify.turnOn')}</button>
        <button class="btn ghost block" onClick=${finish}>${t('onb.later')}</button>`}
      ${step > 0 && !last && html`<button class="btn ghost block" onClick=${() => { setErrors({}); setStep(step - 1); }}>${t('common.back')}</button>`}
    </div>
  </div></main>`;
}
