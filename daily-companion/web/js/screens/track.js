// Track tab: Food · Workout · Steps · Study · Sleep · Weight.
// The section is part of the URL (#/track/food) so the back gesture and
// notification links land in the right place.
import { html } from '../lib/preact.js';
import { t } from '../lib/i18n.js';
import { navigate } from '../lib/router.js';
import { FoodSection } from './track/food.js';
import { WorkoutSection, WorkoutSession } from './track/workout.js';
import { StepsSection } from './track/steps.js';
import { StudySection } from './track/study.js';
import { SleepSection } from './track/sleep.js';
import { WeightSection } from './track/weight.js';

const SECTIONS = [
  ['food', '🍽', FoodSection],
  ['workout', '🏋️', WorkoutSection],
  ['steps', '👟', StepsSection],
  ['study', '📚', StudySection],
  ['sleep', '😴', SleepSection],
  ['weight', '⚖️', WeightSection],
];

export function TrackScreen({ path }) {
  const id = SECTIONS.some((s) => s[0] === path[1]) ? path[1] : 'food';
  // A workout in progress gets the whole screen.
  if (id === 'workout' && path[2]) return html`<${WorkoutSession} id=${path[2]} />`;
  const Section = SECTIONS.find((s) => s[0] === id)[2];
  return html`<div class="screen">
    <div class="screen-head"><div class="grow"><h1 class="title">${t('tabs.track')}</h1></div></div>
    <div class="chips mb-16" role="tablist">
      ${SECTIONS.map(([key, emoji]) => html`<button role="tab" aria-selected=${key === id} class=${`chip ${key === id ? 'active' : ''}`}
        onClick=${() => navigate(`track/${key}`, { replace: true })}>${emoji} ${t(`track.${key}`)}</button>`)}
    </div>
    <${Section} key=${id} />
  </div>`;
}
