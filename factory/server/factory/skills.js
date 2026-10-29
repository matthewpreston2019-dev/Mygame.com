// Skills: small, reusable instruction files that make workers better at recurring jobs.
//
// Before every task:  1. look for a matching local skill (free — keyword match, no tokens)
//                     2. if the manager flagged the task as reusable and nothing matches,
//                        search trusted sources, then 3. create a small new skill.
// New skills are validated before use. Only the 1–2 best matches are loaded into a prompt.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { dataPath, slug, now } from '../core/store.js';
import { log } from '../core/log.js';
import { emit } from '../http/events.js';
import { ask } from '../ai/claude.js';

const MAX_SKILL_BYTES = 4000;
const MAX_LOADED = 2;
const STOP = new Set('the and for with that this from into your you our are was will can how what when make about have has more than then them they their there which while would should could each also just like some such very'.split(' '));

let cache = null;
const learnedDir = () => dataPath('skills');

// ── Reading & writing ───────────────────────────────────

/** Skill file format: a small frontmatter block followed by the instructions. */
export function parseSkill(text, source) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = Object.fromEntries(
    m[1].split('\n').map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].trim()]),
  );
  const list = (v) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    id: slug(meta.name || ''),
    name: meta.name || '',
    description: meta.description || '',
    tags: list(meta.tags),
    workers: list(meta.workers),
    source: meta.source || source,
    origin: meta.origin || '',
    created: meta.created || '',
    body: m[2].trim(),
  };
}

export function serializeSkill(s) {
  return `---\nname: ${s.name}\ndescription: ${s.description}\ntags: ${s.tags.join(', ')}\nworkers: ${s.workers.join(', ')}\nsource: ${s.source}\n${s.origin ? `origin: ${s.origin}\n` : ''}created: ${s.created || now()}\n---\n${s.body}\n`;
}

function readDir(dir, source) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
    .map((f) => parseSkill(fs.readFileSync(path.join(dir, f), 'utf8'), source))
    .filter((s) => s && validate(s).ok);
}

export function allSkills() {
  cache ??= [...readDir(config.builtinSkillsDir, 'builtin'), ...readDir(learnedDir(), 'learned')];
  return cache;
}

export const listSkills = () => allSkills().map(({ body, ...s }) => ({ ...s, size: body.length }));

function store(skill) {
  fs.mkdirSync(learnedDir(), { recursive: true });
  fs.writeFileSync(path.join(learnedDir(), `${skill.id}.md`), serializeSkill(skill));
  cache = null;
  emit('skills', listSkills());
  log.info('skill.added', { skill: skill.name, source: skill.source });
  return skill;
}

// ── Validation ──────────────────────────────────────────

const UNSAFE = [/ignore (all |any )?(previous|prior|above) instructions/i, /<script/i, /\b(api[_-]?key|password|secret)\s*[:=]/i, /\b(rm -rf|curl [^\n]*\| *(ba)?sh)\b/i];

export function validate(s) {
  if (!s?.name || s.name.length > 60) return { ok: false, reason: 'missing or overlong name' };
  if (!s.description || s.description.length > 200) return { ok: false, reason: 'missing or overlong description' };
  if (!s.body || s.body.length < 40) return { ok: false, reason: 'instructions too short' };
  if (Buffer.byteLength(s.body) > MAX_SKILL_BYTES) return { ok: false, reason: 'skill too large' };
  if (UNSAFE.some((re) => re.test(s.body))) return { ok: false, reason: 'unsafe content' };
  return { ok: true };
}

// ── Matching ────────────────────────────────────────────

const words = (text) => new Set(String(text).toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((w) => !STOP.has(w)) ?? []);

function score(skill, taskWords, worker) {
  const skillWords = words(`${skill.name} ${skill.tags.join(' ')} ${skill.description}`);
  let overlap = 0;
  for (const w of skillWords) if (taskWords.has(w)) overlap++;
  const workerFits = !skill.workers.length || skill.workers.includes(worker);
  return workerFits ? overlap + (skill.workers.includes(worker) ? 0.5 : 0) : 0;
}

export function findSkills(task) {
  const taskWords = words(`${task.title} ${task.instruction} ${task.skillHint || ''}`);
  return allSkills()
    .map((s) => ({ s, score: score(s, taskWords, task.worker) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LOADED)
    .map((x) => x.s);
}

const isDuplicate = (candidate) =>
  allSkills().find((s) => s.id === candidate.id || (candidate.tags.length && candidate.tags.filter((t) => s.tags.includes(t)).length / candidate.tags.length >= 0.7));

// ── Discovery ───────────────────────────────────────────

/** Skills for this task: local match → trusted source → newly created (only for reusable work). */
export async function prepareSkills(task, signal) {
  const found = findSkills(task);
  if (found.length || !task.skillHint) return found;

  const imported = await fromTrustedSources(task).catch((err) => {
    log.error('skill.search_failed', { error: err.message });
    return null;
  });
  if (imported) return [imported];

  const created = await createSkill(task, signal).catch((err) => {
    log.error('skill.create_failed', { task: task.id, error: err.message });
    return null;
  });
  return created ? [created] : [];
}

const indexCache = new Map(); // url → { at, skills }

/** A trusted source is an HTTPS JSON index: { "skills": [{ "name", "description", "tags": [], "url" }] } */
async function fromTrustedSources(task) {
  const taskWords = words(`${task.title} ${task.instruction} ${task.skillHint}`);
  for (const indexUrl of config.trustedSkillSources) {
    const origin = new URL(indexUrl).origin;
    let entry = indexCache.get(indexUrl);
    if (!entry || Date.now() - entry.at > 86_400_000) {
      const res = await fetch(indexUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      entry = { at: Date.now(), skills: (await res.json()).skills || [] };
      indexCache.set(indexUrl, entry);
    }
    const best = entry.skills
      .map((s) => ({ s, score: score({ name: s.name, description: s.description || '', tags: s.tags || [], workers: [] }, taskWords, task.worker) }))
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)[0];
    if (!best) continue;

    const url = new URL(best.s.url, indexUrl);
    if (url.protocol !== 'https:' || url.origin !== origin) continue; // only files hosted by the trusted source itself
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const skill = res.ok && parseSkill(await res.text(), 'imported');
    if (!skill || !validate(skill).ok) continue;
    const dupe = isDuplicate(skill);
    if (dupe) return dupe;
    return store({ ...skill, source: 'imported', origin: url.href });
  }
  return null;
}

const SKILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'tags', 'instructions'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    instructions: { type: 'string' },
  },
};

async function createSkill(task, signal) {
  const { json } = await ask({
    tier: 'fast',
    maxTokens: 1500,
    signal,
    schema: SKILL_SCHEMA,
    system: 'You write small reusable skills for AI workers: a short checklist of how to do a kind of job well. Generic, not about one specific request. No secrets, no links.',
    prompt: `Create a reusable skill named "${task.skillHint}" for a ${task.worker} worker.\nExample job it should help with: ${task.instruction.slice(0, 400)}\n\nname: 2–5 words. description: one sentence. tags: 3–6 lowercase keywords. instructions: 5–10 concise bullet points (under 1200 characters).`,
    demo: () => ({
      json: {
        name: task.skillHint,
        description: `How to handle "${task.skillHint}" jobs well.`,
        tags: [...words(task.skillHint)].slice(0, 5),
        instructions: '- Restate the goal in one line.\n- Gather only the facts needed.\n- Structure the answer with short headings.\n- End with clear next steps.\n- (Demo mode: simulated skill.)',
      },
    }),
  });
  const skill = {
    id: slug(json.name),
    name: json.name.slice(0, 60),
    description: json.description.slice(0, 200),
    tags: json.tags.map((t) => t.toLowerCase().trim()).filter(Boolean).slice(0, 6),
    workers: [task.worker],
    source: 'learned',
    body: json.instructions.trim(),
  };
  const check = validate(skill);
  if (!check.ok) throw new Error(`generated skill rejected: ${check.reason}`);
  return isDuplicate(skill) || store(skill);
}

export function deleteSkill(id) {
  const file = path.join(learnedDir(), `${slug(id)}.md`);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  cache = null;
  emit('skills', listSkills());
  return true;
}
