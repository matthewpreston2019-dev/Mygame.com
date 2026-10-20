// =============================================================================
// The evening check-in ("Did you study? Did you train?").
// Answers are saved, shown as your reply in the Coach feed, and the coach
// answers back — so it feels like a conversation.
// =============================================================================
import * as store from './store.js';
import { getLang } from './i18n.js';
import { checkinReply } from '../shared/coach.js';
import { splitName } from '../shared/names.js';
import { t } from './i18n.js';

/**
 * Timestamp for a message written on this device. Always after the newest
 * message in the feed, so the conversation stays in order even if this
 * phone's clock is a little behind the server's.
 */
export function nextMessageTime() {
  const last = store.rows('coach_messages').reduce((m, r) => (r.created_at > m ? r.created_at : m), '');
  return Math.max(Date.now(), last ? Date.parse(last) + 1 : 0);
}

/** Save one answer. field: 'studied' | 'trained'. */
export function answerCheckin(date, field, value) {
  const prev = store.find('checkins', { date });
  store.put('checkins', { date, studied: prev?.studied ?? null, trained: prev?.trained ?? null, [field]: value });

  // Your answer as a chat bubble…
  const mine = field === 'studied'
    ? (value ? t('checkin.iStudied') : t('checkin.iDidNotStudy'))
    : (value ? t('checkin.iTrained') : t('checkin.iDidNotTrain'));
  const at = nextMessageTime();
  store.put('coach_messages', { date, key: `me:${field}:${at}`, kind: 'me', body: mine, data: { type: 'answer' }, created_at: new Date(at).toISOString(), read_at: new Date(at).toISOString() });

  // …and the coach's reply (slightly later so it sorts after yours).
  const ctx = { lang: getLang(), settings: store.settings(), stats: store.stats(), date, templates: store.rows('workout_templates') };
  const reply = checkinReply({ [field]: value }, ctx);
  if (reply) {
    store.put('coach_messages', { date, key: `reply:${field}:${at}`, kind: 'coach', body: reply, data: { type: 'reply', field, value }, created_at: new Date(at + 1).toISOString(), read_at: new Date(at + 1).toISOString() });
  }
}

/** Name of today's split, for check-in wording. */
export function todaysSplit(date) {
  const plan = store.stats().planFor(date);
  return plan.gym ? splitName(plan.gym, store.rows('workout_templates'), getLang()) : null;
}
