// =============================================================================
// Study timer. The running timer lives on this device (localStorage) so it
// survives closing the app; stopping it saves a study session that syncs.
// =============================================================================
import * as store from './store.js';
import { dateInTz } from '../shared/time.js';
import { t } from './i18n.js';
import { toast } from './ui.js';

const KEY = 'dc.studyTimer';
const MAX_MIN = 6 * 60; // a timer left running overnight is capped
const listeners = new Set();
const notify = () => { for (const fn of listeners) fn(); };
export const onTimerChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** { startedAt: ISO, subject } or null */
export function getTimer() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export function startTimer(subject = '') {
  try { localStorage.setItem(KEY, JSON.stringify({ startedAt: new Date().toISOString(), subject: subject.slice(0, 60) })); } catch { /* ignore */ }
  notify();
}

export function elapsedMin(timer = getTimer()) {
  if (!timer) return 0;
  return Math.max(0, (Date.now() - Date.parse(timer.startedAt)) / 60000);
}

/** Stop and save. Returns the minutes saved (0 if under a minute). */
export function stopTimer() {
  const timer = getTimer();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  notify();
  if (!timer) return 0;
  let minutes = Math.round(elapsedMin(timer));
  if (minutes < 1) { toast(t('study.tooShort'), { type: 'info' }); return 0; }
  if (minutes > MAX_MIN) minutes = MAX_MIN;
  const tz = store.settings().timezone;
  store.put('study_sessions', {
    // A session belongs to the day it started.
    date: dateInTz(tz, new Date(timer.startedAt)),
    started_at: timer.startedAt,
    minutes,
    subject: timer.subject || null,
    source: 'timer',
  });
  return minutes;
}

export function discardTimer() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  notify();
}
