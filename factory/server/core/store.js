// Persistent storage: one JSON database plus result files on disk.
//
//   data/db.json                               clouds, projects, tasks, chat, schedules…
//   data/results/<cloud>/<project>/<task>.md   one file per finished task (never duplicated)
//   data/skills/<skill>.md                     skills the factory learned or imported
//   data/logs/<date>.jsonl                     completed-task and error log
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const LIMITS = { chat: 300, tasks: 1500, batches: 300, approvals: 300 };

const empty = () => ({
  version: 1,
  clouds: [],
  projects: [],
  tasks: [],
  batches: [],
  chat: [],
  approvals: [],
  schedules: [],
  spend: { day: '', dayUsd: 0, month: '', monthUsd: 0 },
  settings: {},
});

/** The live database. Mutate it, then call save(). */
export const db = empty();

const dbFile = () => path.join(config.dataDir, 'db.json');
export const dataPath = (...parts) => path.join(config.dataDir, ...parts);

export function load() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  Object.assign(db, empty());
  if (fs.existsSync(dbFile())) Object.assign(db, JSON.parse(fs.readFileSync(dbFile(), 'utf8')));
  return db;
}

let timer = null;
/** Debounced save: many changes in a burst become one write. */
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 150);
}

/** Write immediately (atomic: temp file + rename, so a crash never corrupts the database). */
export function flush() {
  clearTimeout(timer);
  for (const [key, max] of Object.entries(LIMITS)) {
    if (db[key].length > max) db[key] = db[key].slice(-max);
  }
  const tmp = dbFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, dbFile());
}

export const now = () => new Date().toISOString();
export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item';

export const findTask = (id) => db.tasks.find((t) => t.id === id);
export const findProject = (id) => db.projects.find((p) => p.id === id);
export const findCloud = (id) => db.clouds.find((c) => c.id === id);

// ── Result files ────────────────────────────────────────

export function resultPathFor(task) {
  const project = findProject(task.projectId);
  return path.join('results', task.cloudId, slug(project?.name || 'inbox'), `${task.id}.md`);
}

export function writeResult(rel, text) {
  const abs = dataPath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

export function readResult(rel) {
  const abs = dataPath(rel);
  if (!abs.startsWith(config.dataDir + path.sep) || !fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

export function removeResult(rel) {
  const abs = dataPath(rel);
  if (abs.startsWith(config.dataDir + path.sep)) fs.rmSync(abs, { force: true });
}
