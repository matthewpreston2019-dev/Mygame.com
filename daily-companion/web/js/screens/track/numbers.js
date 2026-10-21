// =============================================================================
// Reading numbers that a person typed, shared by all Track screens.
//   num('72,5')       → 72.5   decimals: comma or dot both work (kg, protein)
//   wholeNum('1,200') → 1200   whole numbers: thousands separators work too
//                              (kcal, steps, minutes, reps)
// =============================================================================

import { num } from '../onboarding.js';

export { num };

// A thousands separator: dot, comma, apostrophe (Swiss "10'000") or a space.
const SEP = "[.,'’\\s]";
// "1,200", "10.000", "1 234 567": 1–3 digits, then groups of exactly 3 digits,
// always with the same separator (\1 repeats the first one).
const GROUPED = new RegExp(`^\\d{1,3}(${SEP})\\d{3}(\\1\\d{3})*$`);

/**
 * Parse a number for a field that holds a whole number. Here "1,200" and
 * "1.200" mean 1200 (not 1.2, which would be saved as 1 kcal). Anything else
 * is read with num(), so "8.5" stays 8.5 and the field's own check can
 * reject or round it. Returns NaN if empty/invalid.
 */
export function wholeNum(v) {
  const s = String(v ?? '').trim();
  return GROUPED.test(s) ? Number(s.replace(new RegExp(SEP, 'g'), '')) : num(s);
}
