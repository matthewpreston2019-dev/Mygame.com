// =============================================================================
// Quests: ticking manual quests, auto-completing data-driven ones, and the
// small celebrations (confetti + XP toast, bigger one on level-up).
// =============================================================================

import * as store from './store.js';
import { t } from './i18n.js';
import { toast, confetti, haptic } from './ui.js';
import { dateInTz, addDays } from '../shared/time.js';
import { levelFromXp } from '../shared/stats.js';

/** Display title of a quest (built-ins are translated). */
export function questTitle(q, stats) {
  if (q.title) return q.title;
  if (q.key === 'steps' && stats) return t('quests.stepsN', { n: store.settings().targets.steps });
  return t(`quests.${q.key}`);
}

export const today = () => dateInTz(store.settings().timezone);

function celebrate(xpGained, title) {
  const before = levelFromXp(store.stats().xp - xpGained).level;
  const after = store.stats().level.level;
  haptic(12);
  if (after > before) {
    confetti({ count: 160 });
    toast(t('quests.levelUp', { n: after }), { type: 'xp', duration: 3500 });
  } else {
    confetti({ count: 70 });
    toast(`+${xpGained} XP · ${title}`, { type: 'xp' });
  }
  // Perfect day?
  const c = store.stats().completion(today());
  if (c.applicable > 1 && c.done === c.applicable) {
    setTimeout(() => { confetti({ count: 120, originY: 0.25 }); toast(t('quests.perfectDay'), { type: 'xp', duration: 3200 }); }, 900);
  }
}

/** Tick / untick a manual quest. */
export function toggleQuest(quest, date) {
  const existing = store.find('quest_log', { quest_id: quest.id, date });
  if (existing) {
    store.remove('quest_log', { quest_id: quest.id, date });
    haptic(5);
    return false;
  }
  store.put('quest_log', { quest_id: quest.id, date, xp: quest.xp });
  if (date === today()) celebrate(quest.xp, questTitle(quest));
  else toast(`+${quest.xp} XP`, { type: 'xp' });
  return true;
}

let running = false;
/**
 * Make the quest log match your data for the last 7 days: an auto quest whose
 * goal is met earns its XP; if the data changes (e.g. you delete a meal) and
 * the goal is no longer met, the XP is taken back. Only writes when something
 * actually differs, so it's cheap to call after every change.
 */
export function reconcileQuests() {
  if (running || !store.status.ready) return;
  running = true;
  try {
    const stats = store.stats();
    const todayStr = today();
    const celebrations = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(todayStr, -i);
      for (const qs of stats.questsFor(date)) {
        const q = qs.quest;
        if (q.kind === 'manual') continue;
        const log = store.find('quest_log', { quest_id: q.id, date });
        if (qs.done && !log) {
          store.put('quest_log', { quest_id: q.id, date, xp: q.xp });
          // Only celebrate live progress, not catch-up after a fresh install.
          if (date === todayStr && store.status.synced) celebrations.push([q.xp, questTitle(q, stats)]);
        } else if (!qs.done && log) {
          store.remove('quest_log', { quest_id: q.id, date });
        } else if (qs.done && log && log.xp !== q.xp) {
          store.put('quest_log', { quest_id: q.id, date, xp: q.xp });
        }
      }
    }
    for (const [xp, title] of celebrations) celebrate(xp, title);
  } finally {
    running = false;
  }
}
