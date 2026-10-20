// Checks that every translation key used in the code exists in English, and
// reports keys missing from the other languages.
//   node tests/check-i18n.mjs          (fails if English is missing a key)
//   node tests/check-i18n.mjs --strict (also fails if any language is missing a key)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'js');
const strict = process.argv.includes('--strict');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === 'i18n' ? [] : walk(p)) : p.endsWith('.js') ? [p] : [];
  });
}

// Keys built at runtime (t(`notify.${k}`) etc.) — listed here so they're checked too.
const DYNAMIC = [
  ...['today', 'coach', 'track', 'calendar', 'profile'].map((k) => `tabs.${k}`),
  ...['food', 'workout', 'steps', 'study', 'sleep', 'weight'].map((k) => `track.${k}`),
  ...['relax', 'gym', 'study'].map((k) => `block.${k}`),
  ...['school', 'study', 'gym', 'exam', 'custom'].map((k) => `calendar.kind.${k}`),
  ...['breakfast', 'lunch', 'dinner', 'snack'].map((k) => `food.meal.${k}`),
  ...['plan', 'study', 'gym', 'checkin', 'summary', 'winddown', 'nudges', 'weekly', 'morning'].flatMap((k) => [`notify.${k}`, `notify.${k}Desc`]),
  ...['short', 'long', 'weekend', 'rest'].map((k) => `planner.typeHint.${k}`),
  ...['pushups', 'study', 'steps', 'gym', 'protein'].map((k) => `quests.${k}`),
  ...['study', 'steps', 'workout', 'protein'].map((k) => `quests.autoHint.${k}`),
  ...['manual', 'study', 'steps', 'workout', 'protein'].map((k) => `quests.kind.${k}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `shortcut.step${n}`),
  ...[1, 2, 3, 4].map((n) => `shortcut.auto${n}`),
  ...['timer', 'manual', 'checkin'].map((k) => `study.src.${k}`),
];

const used = new Set(DYNAMIC);
for (const file of walk(root)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
}

const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const langs = readdirSync(join(root, 'i18n')).filter((f) => f.endsWith('.js'));
const dicts = {};
for (const f of langs) dicts[f.replace('.js', '')] = (await import(pathToFileURL(join(root, 'i18n', f)))).default;

let failed = false;
const missingEn = [...used].filter((k) => get(dicts.en, k) === undefined);
if (missingEn.length) { failed = true; console.error('Missing in en:', missingEn); }

// All leaf keys of English, to compare other languages fully.
function leaves(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    const isPlural = v && typeof v === 'object' && !Array.isArray(v) && 'other' in v;
    return v && typeof v === 'object' && !Array.isArray(v) && !isPlural ? leaves(v, key) : [key];
  });
}
const enKeys = leaves(dicts.en);
for (const [lang, dict] of Object.entries(dicts)) {
  if (lang === 'en') continue;
  const missing = enKeys.filter((k) => get(dict, k) === undefined);
  const extra = leaves(dict).filter((k) => get(dicts.en, k) === undefined);
  // Placeholders must match, or the text would show "{n}" literally.
  const badVars = enKeys.filter((k) => {
    const a = get(dicts.en, k), b = get(dict, k);
    if (b === undefined) return false;
    const vars = (v) => [...new Set(JSON.stringify(v).match(/\{\w+\}/g) || [])].sort().join(',');
    return vars(a) !== vars(b);
  });
  if (missing.length || extra.length || badVars.length) {
    console.log(`${lang}: ${missing.length} missing, ${extra.length} extra, ${badVars.length} placeholder mismatches`);
    if (missing.length) console.log('  missing:', missing.slice(0, 40).join(', '));
    if (extra.length) console.log('  extra:', extra.join(', '));
    if (badVars.length) console.log('  placeholders:', badVars.join(', '));
    if (strict) failed = true;
  } else console.log(`${lang}: complete ✓`);
}
const unused = enKeys.filter((k) => ![...used].some((u) => u === k || k.startsWith(u + '.')));
if (unused.length) console.log(`en: ${unused.length} keys not referenced in code:`, unused.join(', '));
console.log(`${used.size} keys used in code; en has ${enKeys.length}.`);
if (failed) process.exit(1);
