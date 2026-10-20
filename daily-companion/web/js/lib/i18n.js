// =============================================================================
// Translations + locale-aware formatting.
// -----------------------------------------------------------------------------
//   t('today.title')                     → "Today"
//   t('food.left', { n: 450 })           → "450 kcal left"
// Plural forms: a value can be an object keyed by Intl.PluralRules categories
//   { one: '{n} day', other: '{n} days' }  (Russian/Arabic use few/many/…)
// English (i18n/en.js) is always loaded as the fallback, so a missing key in
// another language shows English instead of breaking.
// =============================================================================

import en from '../i18n/en.js';
import { toMinutes } from '../shared/time.js';

const LOCALES = { en: 'en-GB', es: 'es-ES', de: 'de-DE', ru: 'ru-RU', zh: 'zh-CN', ar: 'ar-u-nu-latn' };
const RTL = new Set(['ar']);

let lang = 'en';
let dict = en;
let plural = new Intl.PluralRules('en');
const listeners = new Set();

export const getLang = () => lang;
export const getLocale = () => LOCALES[lang] || 'en-GB';
export const isRtl = () => RTL.has(lang);
export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Switch language (loads the file on demand) and flip the page direction. */
export async function setLanguage(code) {
  const next = LOCALES[code] ? code : 'en';
  if (next !== 'en') {
    try { dict = (await import(`../i18n/${next}.js`)).default; } catch (e) { console.error('lang load failed', e); dict = en; }
  } else dict = en;
  lang = next;
  plural = new Intl.PluralRules(LOCALES[lang]);
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
  try { localStorage.setItem('dc.lang', lang); } catch { /* storage blocked */ }
  for (const fn of listeners) fn(lang);
}

function lookup(d, key) {
  let v = d;
  for (const part of key.split('.')) { v = v?.[part]; if (v === undefined) return undefined; }
  return v;
}

/** Translate a key, filling {placeholders} from vars. */
export function t(key, vars) {
  let v = lookup(dict, key);
  if (v === undefined) v = lookup(en, key);
  if (v === undefined) return key;
  if (typeof v === 'object' && !Array.isArray(v)) {
    const n = Number(vars?.n ?? vars?.count ?? 0);
    v = v[plural.select(n)] ?? v.other ?? Object.values(v)[0];
  }
  if (typeof v !== 'string') return v;
  if (!vars) return v;
  return v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? (typeof vars[k] === 'number' ? fmtNum(vars[k]) : vars[k]) : m));
}

/** Array value (e.g. lists of tips). */
export const tList = (key) => { const v = lookup(dict, key) ?? lookup(en, key); return Array.isArray(v) ? v : []; };

// ---- formatting -----------------------------------------------------------
const nfCache = new Map();
export function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '–';
  const k = `${lang}|${digits}`;
  if (!nfCache.has(k)) nfCache.set(k, new Intl.NumberFormat(getLocale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 }));
  return nfCache.get(k).format(n);
}

/** '2026-10-21' → "Wed, 21 Oct" (style: 'short' | 'long' | 'weekday' | 'dayMonth' | 'month') */
export function fmtDate(dateStr, style = 'short') {
  const d = new Date(dateStr + 'T12:00:00Z');
  const opts = {
    short: { weekday: 'short', day: 'numeric', month: 'short' },
    long: { weekday: 'long', day: 'numeric', month: 'long' },
    weekday: { weekday: 'short' },
    narrow: { weekday: 'narrow' },
    weekdayLong: { weekday: 'long' },
    dayMonth: { day: 'numeric', month: 'short' },
    month: { month: 'long', year: 'numeric' },
    full: { day: 'numeric', month: 'short', year: 'numeric' },
  }[style] || {};
  return new Intl.DateTimeFormat(getLocale(), { ...opts, timeZone: 'UTC' }).format(d);
}

/** Time of an instant in your time zone, e.g. "21:04". */
export function fmtClock(instant, tz) {
  return new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date(instant));
}

/**
 * Keep a left-to-right snippet (like "17:00–18:00" or "22:30 → 07:00") in order
 * inside right-to-left text (Arabic). Uses Unicode isolate characters.
 */
export const ltr = (s) => `\u2066${s}\u2069`;

/** 'HH:MM' shown as-is but with locale digits. */
export const fmtHHMM = (hhmm) => (Number.isNaN(toMinutes(hhmm)) ? '–' : hhmm);

/** 135 → "2 h 15 min" */
export function fmtDuration(min) {
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60), r = m % 60;
  if (h && r) return t('units.hm', { h, m: r });
  if (h) return t('units.h', { h });
  return t('units.min', { m: r });
}
