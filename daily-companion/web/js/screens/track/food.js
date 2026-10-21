// =============================================================================
// Food: log meals (name, kcal, protein), see totals vs targets, re-log
// favorites and recent foods in one tap, and browse history.
// =============================================================================

import { html, useState } from '../../lib/preact.js';
import * as store from '../../lib/store.js';
import { t, fmtNum, fmtDate, fmtClock } from '../../lib/i18n.js';
import { useClock } from '../../lib/clock.js';
import { addDays, minutesInTz, zonedTimeToDate } from '../../shared/time.js';
import { Ring, Bar, SheetFrame, Field, Seg, Toggle, Empty, confirmDialog } from '../../components/common.js';
import { Icon } from '../../components/icons.js';
import { DateNav } from '../../components/datenav.js';
import { openSheet, toast, haptic } from '../../lib/ui.js';
import { num, wholeNum } from './numbers.js';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_TIME = { breakfast: '08:00', lunch: '12:30', dinner: '19:00', snack: '16:00' };

/** Which meal it probably is, from the local time. */
function mealFor(minutes) {
  if (minutes < 10 * 60 + 30) return 'breakfast';
  if (minutes < 15 * 60) return 'lunch';
  if (minutes >= 17 * 60 && minutes < 21 * 60 + 30) return 'dinner';
  return 'snack';
}

/** When it was eaten: now for today, otherwise a typical time for the meal. */
function eatenAt(date, meal, tz) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  return date === today ? new Date().toISOString() : zonedTimeToDate(date, MEAL_TIME[meal], tz).toISOString();
}

export function FoodSection() {
  const { date: today, tz } = useClock();
  // Only a day you picked yourself is kept. Otherwise the screen follows the
  // clock, so it moves on to the new day after midnight (the app can stay
  // open in the background overnight).
  const [picked, setPicked] = useState(null);
  const date = picked ?? today;
  const pick = (d) => setPicked(d === today ? null : d);
  const s = store.settings();
  const day = store.stats().day(date);
  const left = s.targets.kcal - day.kcal;
  const byMeal = MEALS.map((m) => [m, day.foods.filter((f) => f.meal === m)]).filter(([, list]) => list.length);

  return html`
    <${DateNav} date=${date} today=${today} onChange=${pick} />
    <div class="card">
      <div class="row" style="gap:16px">
        <${Ring} value=${day.kcal / s.targets.kcal} size=${92} stroke=${9} color=${day.kcal > s.targets.kcal * 1.1 ? 'var(--danger)' : 'var(--sage)'}>
          <div><div class="bold tnum" style="font-size:19px">${fmtNum(day.kcal)}</div><div class="tiny faint">/ ${fmtNum(s.targets.kcal)}</div></div>
        </${Ring}>
        <div class="grow">
          <div class="bold">${left >= 0 ? t('food.left', { n: fmtNum(left) }) : t('food.over', { n: fmtNum(-left) })}</div>
          <div class="small muted mt-8">${t('food.protein')} · ${fmtNum(Math.round(day.protein))} / ${s.targets.protein} g</div>
          <div class="mt-4"><${Bar} value=${day.protein / s.targets.protein} /></div>
          ${day.protein < s.targets.protein && html`<div class="tiny faint mt-4">${t('food.proteinLeft', { n: fmtNum(Math.round(s.targets.protein - day.protein)) })}</div>`}
        </div>
      </div>
    </div>

    <button class="btn primary block mt-12" onClick=${() => openAddFood(date)}><${Icon} name="plus" />${t('food.add')}</button>

    ${byMeal.length === 0 && html`<${Empty} emoji="🍽" title=${t('food.emptyTitle')} text=${t('food.emptyText')} />`}
    ${byMeal.map(([meal, list]) => html`
      <div class="section-title">${t(`food.meal.${meal}`)}<span class="faint" style="text-transform:none;letter-spacing:0">${fmtNum(list.reduce((a, f) => a + f.kcal, 0))} kcal</span></div>
      <div class="list">
        ${list.map((f) => html`<button class="li" onClick=${() => openEditFood(f)}>
          <span class="grow"><div class="label ellipsis">${f.name}</div>
            <div class="sub">${fmtNum(Number(f.protein))} g ${t('food.protein')} · ${fmtClock(f.eaten_at, tz)}</div></span>
          <span class="value">${fmtNum(f.kcal)} kcal</span>
        </button>`)}
      </div>`)}

    <${FoodHistory} today=${today} onPick=${pick} />`;
}

function FoodHistory({ today, onPick }) {
  const s = store.settings();
  const stats = store.stats();
  const days = [];
  for (let i = 1; i <= 14; i++) {
    const d = addDays(today, -i);
    const day = stats.day(d);
    if (day.foods.length) days.push(day);
  }
  if (!days.length) return null;
  return html`<div class="section-title">${t('food.history')}</div>
    <div class="list">
      ${days.map((d) => {
        const kcalOk = Math.abs(d.kcal - s.targets.kcal) <= s.targets.kcal * 0.1;
        const protOk = d.protein >= s.targets.protein;
        return html`<button class="li" onClick=${() => { onPick(d.date); scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <span class="grow"><div class="label">${fmtDate(d.date, 'short')}</div>
            <div class="sub">${fmtNum(Math.round(d.protein))} g ${t('food.protein')} ${protOk ? '✓' : ''}</div></span>
          <span class="value" style=${kcalOk ? 'color:var(--sage)' : ''}>${fmtNum(d.kcal)} kcal</span>
          <${Icon} name="chev" class="chev" />
        </button>`;
      })}
    </div>`;
}

// ---- Add / edit ----------------------------------------------------------------

function FoodForm({ date, food, close }) {
  const tz = store.settings().timezone;
  const isEdit = !!food;
  const [f, setF] = useState({
    name: food?.name || '',
    kcal: food ? String(food.kcal) : '',
    protein: food ? String(Number(food.protein)) : '',
    meal: food?.meal || mealFor(minutesInTz(tz)),
    favorite: false,
  });
  const [errors, setErrors] = useState({});
  const favs = store.rows('food_favorites').slice().sort((a, b) => b.use_count - a.use_count || a.name.localeCompare(b.name));
  const query = f.name.trim().toLowerCase();

  // Recent distinct foods (last 60 days) that aren't favorites, for quick re-logging.
  const recent = (() => {
    const seen = new Set(favs.map((x) => x.name.toLowerCase()));
    const out = [];
    for (const r of store.rows('foods').slice().sort((a, b) => String(b.eaten_at).localeCompare(String(a.eaten_at)))) {
      const k = r.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
      if (out.length >= 12) break;
    }
    return out;
  })();
  const filter = (x) => !query || x.name.toLowerCase().includes(query);

  function validate() {
    const e = {};
    const name = f.name.trim();
    if (!name) e.name = t('validate.required');
    if (name.length > 80) e.name = t('validate.tooLong', { n: 80 });
    // kcal is a whole number, so "1,200" or "1.200" means 1200 (not 1.2).
    const kcal = wholeNum(f.kcal), protein = f.protein === '' ? 0 : num(f.protein);
    if (!(Number.isFinite(kcal) && kcal >= 0 && kcal <= 10000)) e.kcal = t('validate.range', { min: 0, max: 10000 });
    if (!(Number.isFinite(protein) && protein >= 0 && protein <= 1000)) e.protein = t('validate.range', { min: 0, max: 1000 });
    else if (Number.isFinite(kcal) && protein * 4 > kcal + 20 && kcal > 0) e.protein = t('food.proteinTooHigh');
    setErrors(e);
    return Object.keys(e).length ? null : { name, kcal: Math.round(kcal), protein: Math.round(protein * 10) / 10 };
  }

  function save() {
    const v = validate();
    if (!v) return;
    if (isEdit) {
      store.put('foods', { id: food.id, ...v, meal: f.meal });
    } else {
      store.put('foods', { date, eaten_at: eatenAt(date, f.meal, tz), meal: f.meal, ...v });
      if (f.favorite) saveFavorite(v);
    }
    haptic();
    toast(isEdit ? t('common.saved') : t('food.logged', { name: v.name }));
    close(true);
  }

  // One tap on a favorite/recent logs it immediately.
  function quickLog(item, isFav) {
    store.put('foods', { date, eaten_at: eatenAt(date, f.meal, tz), meal: f.meal, name: item.name, kcal: item.kcal, protein: Number(item.protein) });
    if (isFav) store.put('food_favorites', { id: item.id, use_count: (item.use_count || 0) + 1 });
    haptic();
    toast(t('food.logged', { name: item.name }));
    close(true);
  }

  async function del() {
    if (!(await confirmDialog({ title: t('food.delete'), text: food.name, ok: t('common.delete'), danger: true }))) return;
    store.remove('foods', { id: food.id });
    close(true);
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.currentTarget.value });
  return html`<${SheetFrame} title=${isEdit ? t('food.edit') : t('food.add')} close=${close}
    footer=${html`<button class="btn primary block" onClick=${save}>${isEdit ? t('common.save') : t('food.logIt')}</button>`}>
    <${Seg} value=${f.meal} onChange=${(v) => setF({ ...f, meal: v })} options=${MEALS.map((m) => ({ value: m, label: t(`food.meal.${m}`) }))} />
    <div class="mt-12"></div>
    <${Field} label=${t('food.name')} error=${errors.name}>
      <input value=${f.name} maxlength="80" placeholder=${t('food.namePlaceholder')} onInput=${set('name')} autocomplete="off" enterkeyhint="next" /></${Field}>
    <div class="grid-2">
      <${Field} label="kcal" error=${errors.kcal}><input inputmode="numeric" value=${f.kcal} onInput=${set('kcal')} placeholder="0" enterkeyhint="next" /></${Field}>
      <${Field} label=${t('food.protein') + ' (g)'} error=${errors.protein}><input inputmode="decimal" value=${f.protein} onInput=${set('protein')} placeholder="0" enterkeyhint="done" /></${Field}>
    </div>
    ${!isEdit && html`<div class="li" style="padding:0 2px;min-height:44px">
      <span class="grow label">⭐ ${t('food.saveFavorite')}</span>
      <${Toggle} label=${t('food.saveFavorite')} checked=${f.favorite} onChange=${(v) => setF({ ...f, favorite: v })} /></div>`}
    ${isEdit && html`<div class="btn-row mt-8">
      <button class="btn" onClick=${() => { const v = validate(); if (v) { saveFavorite(v); toast(t('food.favSaved')); } }}><${Icon} name="star" />${t('food.toFavorite')}</button>
      <button class="btn danger" onClick=${del}><${Icon} name="trash" />${t('common.delete')}</button></div>`}

    ${!isEdit && favs.filter(filter).length > 0 && html`<div class="section-title">${t('food.favorites')}<button class="link-btn" onClick=${() => openFavoritesManager()}>${t('common.edit')}</button></div>
      <div class="list">${favs.filter(filter).map((x) => html`<button class="li" onClick=${() => quickLog(x, true)}>
        <span class="grow"><div class="label ellipsis">⭐ ${x.name}</div><div class="sub">${fmtNum(x.kcal)} kcal · ${fmtNum(Number(x.protein))} g</div></span>
        <${Icon} name="plus" class="chev" /></button>`)}</div>`}
    ${!isEdit && recent.filter(filter).length > 0 && html`<div class="section-title">${t('food.recent')}</div>
      <div class="list">${recent.filter(filter).map((x) => html`<button class="li" onClick=${() => quickLog(x, false)}>
        <span class="grow"><div class="label ellipsis">${x.name}</div><div class="sub">${fmtNum(x.kcal)} kcal · ${fmtNum(Number(x.protein))} g</div></span>
        <${Icon} name="plus" class="chev" /></button>`)}</div>`}
  </${SheetFrame}>`;
}

/** Add or update a favorite with the same name. */
function saveFavorite(v) {
  const existing = store.rows('food_favorites').find((x) => x.name.toLowerCase() === v.name.toLowerCase());
  store.put('food_favorites', { ...(existing ? { id: existing.id, use_count: existing.use_count } : { use_count: 0 }), name: v.name, kcal: v.kcal, protein: v.protein });
}

function FavoritesManager({ close }) {
  const favs = store.rows('food_favorites').slice().sort((a, b) => a.name.localeCompare(b.name));
  return html`<${SheetFrame} title=${t('food.favorites')} close=${close}>
    ${favs.length === 0 && html`<${Empty} emoji="⭐" text=${t('food.noFavorites')} />`}
    <div class="list">${favs.map((x) => html`<div class="li">
      <span class="grow"><div class="label ellipsis">${x.name}</div><div class="sub">${fmtNum(x.kcal)} kcal · ${fmtNum(Number(x.protein))} g</div></span>
      <button class="icon-btn plain" aria-label=${t('common.delete')} onClick=${() => store.remove('food_favorites', { id: x.id })}><${Icon} name="trash" /></button>
    </div>`)}</div>
  </${SheetFrame}>`;
}

export const openAddFood = (date) => openSheet(({ close }) => html`<${FoodForm} date=${date} close=${close} />`);
const openEditFood = (food) => openSheet(({ close }) => html`<${FoodForm} date=${food.date} food=${food} close=${close} />`);
const openFavoritesManager = () => openSheet(({ close }) => html`<${FavoritesManager} close=${close} />`);
