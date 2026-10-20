// A clock hook that re-renders the screen every 30 s and when the app comes
// back to the foreground, so "now", "next" and the date roll over correctly
// (including at midnight and across daylight-saving changes).
import { useEffect, useState } from './preact.js';
import { dateInTz, minutesInTz } from '../shared/time.js';
import * as store from './store.js';

export function useClock() {
  const tz = store.settings().timezone;
  const [, tick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => tick((x) => x + 1), 30000);
    const vis = () => { if (document.visibilityState === 'visible') tick((x) => x + 1); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', vis); };
  }, []);
  const now = new Date();
  return { now, date: dateInTz(tz, now), minutes: minutesInTz(tz, now), tz };
}
