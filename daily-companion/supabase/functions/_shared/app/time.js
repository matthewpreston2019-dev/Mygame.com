// =============================================================================
// Time helpers — time-zone and daylight-saving aware.
// -----------------------------------------------------------------------------
// The app thinks in *local wall-clock time* of your time zone (default
// Europe/Berlin), no matter where the code runs: your iPhone or a Supabase
// server in UTC. We never use the device's own offset; we always ask
// Intl.DateTimeFormat what the clock says in the chosen zone.
//
// Conventions:
//   date string  'YYYY-MM-DD'  (a calendar day in your time zone)
//   time string  'HH:MM'       (24h wall-clock time)
//   minutes      number of minutes after local midnight (e.g. 14:30 → 870)
//
// This file is shared with the server (copied by scripts/sync-shared.sh), so
// it must not use browser-only APIs.
// =============================================================================

const fmtCache = new Map();
function partsFormatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(instant, tz) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  // Some engines report midnight as hour 24 — normalise.
  if (out.hour === 24) out.hour = 0;
  return out; // { year, month, day, hour, minute, second }
}

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for the local day of an instant (default: now). */
export function dateInTz(tz, instant = new Date()) {
  const p = zonedParts(instant, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes after local midnight for an instant (default: now). */
export function minutesInTz(tz, instant = new Date()) {
  const p = zonedParts(instant, tz);
  return p.hour * 60 + p.minute;
}

/** 'HH:MM' → minutes. Returns NaN for invalid input. */
export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return NaN;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return NaN;
  return h * 60 + mi;
}

/** minutes → 'HH:MM' (wraps past midnight). */
export function toHHMM(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Valid 'HH:MM'? */
export const isHHMM = (s) => !Number.isNaN(toMinutes(s));

/** Valid 'YYYY-MM-DD'? */
export function isDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Pure calendar arithmetic on date strings (no time zones involved). */
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Weekday of a date string: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay();
}

/** Monday of the week containing dateStr (weeks run Mon–Sun). */
export function weekStart(dateStr) {
  const wd = weekdayOf(dateStr);
  return addDays(dateStr, -((wd + 6) % 7));
}

/** Whole days from a to b (b − a). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

/** Inclusive list of date strings from a to b. */
export function dateRange(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * The real instant (Date) when the wall clock in `tz` shows `hhmm` on `dateStr`.
 * Handles daylight saving: we guess using the offset at that moment and
 * correct once. For the skipped hour in spring (02:00–03:00 doesn't exist),
 * the result lands one hour later, which is what a person would expect.
 */
export function zonedTimeToDate(dateStr, hhmm, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const mins = toMinutes(hhmm);
  const wallAsUtc = Date.UTC(y, mo - 1, d, Math.floor(mins / 60), mins % 60);
  let guess = wallAsUtc - offsetMs(tz, wallAsUtc);
  // Re-check with the offset at the guessed instant (matters near DST switches).
  const second = wallAsUtc - offsetMs(tz, guess);
  if (second !== guess) guess = second;
  return new Date(guess);
}

/** Offset of tz from UTC at an instant, in ms (Berlin summer → +7 200 000). */
export function offsetMs(tz, instantMs) {
  const p = zonedParts(new Date(instantMs), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Is this a real IANA time zone the engine knows? */
export function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
