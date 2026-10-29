// Append-only log of completed tasks and errors: data/logs/YYYY-MM-DD.jsonl
// The most recent entries are also kept in memory for the Settings → Logs view.
import fs from 'node:fs';
import { dataPath } from './store.js';

const recentEntries = [];

function write(level, event, data = {}) {
  const entry = { at: new Date().toISOString(), level, event, ...data };
  recentEntries.push(entry);
  if (recentEntries.length > 200) recentEntries.shift();
  try {
    fs.mkdirSync(dataPath('logs'), { recursive: true });
    fs.appendFileSync(dataPath('logs', `${entry.at.slice(0, 10)}.jsonl`), JSON.stringify(entry) + '\n');
  } catch {
    /* logging must never crash the factory */
  }
  if (level === 'error') console.error(`[${event}]`, data.error || '');
  return entry;
}

export const log = {
  info: (event, data) => write('info', event, data),
  error: (event, data) => write('error', event, data),
  recent: (n = 100) => recentEntries.slice(-n).reverse(),
};
