// =============================================================================
// Default settings. Your saved settings (profiles.settings in Supabase) are
// merged on top of these, so adding a new setting here automatically gives
// it a sensible value for existing users.
// Shared with the server — keep it free of browser APIs.
// =============================================================================

export const DEFAULT_SETTINGS = {
  language: 'en',            // en | es | de | ru | zh | ar
  theme: 'dark',             // dark | light | system
  timezone: 'Europe/Berlin',
  onboarded: false,

  schedule: {
    // Day type for each weekday (0 = Sunday … 6 = Saturday).
    days: { 0: 'weekend', 1: 'short', 2: 'long', 3: 'short', 4: 'long', 5: 'short', 6: 'weekend' },
    schoolStart: '08:00',
    freeFrom: { short: '14:30', long: '17:00' },
    // Order of the after-school blocks. Gym is skipped on non-gym days.
    order: ['relax', 'gym', 'study'],
    relaxMin: { short: 60, long: 60 },
    gymMin: 75,
    afterGymMin: 45,          // shower + eat after the gym
    studyMin: { short: 120, long: 45, weekend: 60 },
    weekendStudyAt: '11:00',
    weekendGymAt: '15:00',    // used only for catch-up sessions
    // Gym split per weekday (template key or template id).
    gymDays: { 1: 'upper', 3: 'lower', 5: 'upper' },
    checkinAt: '21:00',
    windDownAt: '22:00',
    lightsOut: '22:30',
    wakeAt: '07:00',
  },

  targets: {
    steps: 8000,
    kcal: 2200,
    protein: 140,
    goalWeight: 69,
  },

  // Optional body profile → used to suggest calorie/protein targets.
  body: {
    weight: null,   // kg, current
    height: null,   // cm
    age: null,
    sex: null,      // 'male' | 'female'
    activity: 1.55, // moderate: gym 3×/week + ~8k steps
    deficit: 400,   // kcal below maintenance (slow, muscle-friendly fat loss)
  },

  // Push notifications per message type (the Coach feed always gets them).
  notify: {
    plan: true,      // after-school plan
    study: true,     // study start / end
    gym: true,       // gym reminder
    checkin: true,   // 21:00 check-in
    summary: true,   // daily summary
    winddown: true,  // 22:00 wind-down
    nudges: true,    // missed-goal nudges
    weekly: true,    // Sunday weekly report
    morning: true,   // exam-day morning message
  },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merge saved settings over the defaults (arrays are replaced, not merged). */
export function mergeSettings(saved, base = DEFAULT_SETTINGS) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!isObj(saved)) return out;
  for (const [k, v] of Object.entries(saved)) {
    if (isObj(v) && isObj(base[k])) out[k] = mergeSettings(v, base[k]);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: '中文' },
  { code: 'ar', name: 'العربية', rtl: true },
];

/**
 * Suggested daily targets from the body profile (Mifflin–St Jeor BMR × activity
 * − deficit; protein ≈ 2 g per kg of goal weight, which supports muscle while
 * losing fat). Returns null when the profile is incomplete.
 */
export function suggestTargets(body, goalWeight) {
  const { weight, height, age, sex, activity, deficit } = body || {};
  if (!(weight > 0 && height > 0 && age > 0) || !['male', 'female'].includes(sex)) return null;
  const bmr = 10 * weight + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161);
  const maintenance = bmr * (activity || 1.55);
  // Never suggest less than BMR — eating below it makes recovery and training worse.
  const kcal = Math.max(Math.round(bmr), Math.round((maintenance - (deficit ?? 400)) / 10) * 10);
  const proteinBase = goalWeight > 0 ? goalWeight : weight;
  const protein = Math.round((proteinBase * 2) / 5) * 5;
  return { kcal, protein, maintenance: Math.round(maintenance / 10) * 10, bmr: Math.round(bmr) };
}
