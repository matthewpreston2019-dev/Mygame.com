// Pure functions: no database, no network. Shared by the server and the tests (test/logic.test.js).

// ── Workers ─────────────────────────────────────────────

export const WORKERS: Record<string, { name: string; tier: string; web?: boolean; role: string }> = {
  research: { name: 'Researcher', tier: 'standard', web: true, role: 'You research topics using Google Search and report verified, sourced findings.' },
  coding: { name: 'Engineer', tier: 'standard', role: 'You plan and write software: architecture, code, technical guides. Give complete, working code when code is asked for.' },
  content: { name: 'Creator', tier: 'standard', role: 'You create content: YouTube ideas, titles, scripts, editing workflows and analytics advice.' },
  finance: { name: 'Analyst', tier: 'standard', role: 'You analyse business ideas, budgets, costs and opportunities. Show numbers and state assumptions.' },
  automation: { name: 'Automator', tier: 'fast', role: 'You design automations, schedules, scripts and file-organisation plans for repetitive work.' },
  assistant: { name: 'Assistant', tier: 'fast', role: 'You are a personal assistant: tasks, reminders, plans, emails and short daily briefings.' },
};

// ── Text helpers ────────────────────────────────────────

const STOP = new Set('the and for with that this from into your you our are was will can how what when make about have has more than then them they their there which while would should could each also just like some such very'.split(' '));

/** Meaningful lowercase words (3+ letters, no stop words). */
export const words = (text: string) => new Set(String(text).toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((w) => !STOP.has(w)) ?? []);

export const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;

export const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const firstSentence = (text: string) =>
  text.replace(/^#+.*$/gm, '').replace(/[*_`>#-]/g, '').trim().split(/(?<=[.!?])\s/)[0].slice(0, 220);

export const slug = (s: string) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item';

/** A file name that works on Windows, macOS, iOS and in Obsidian. */
export const safeName = (s: string) => String(s).replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';

// ── Skills ──────────────────────────────────────────────

export type Skill = { id: string; name: string; description: string; tags: string[]; workers: string[]; body: string; source?: string; origin?: string };

/** How well a skill fits a task: shared keywords, and only for workers it is meant for. */
export function skillScore(skill: Skill, taskWords: Set<string>, worker: string) {
  if (skill.workers.length && !skill.workers.includes(worker)) return 0;
  return overlap(words(`${skill.name} ${skill.tags.join(' ')} ${skill.description}`), taskWords) + (skill.workers.includes(worker) ? 0.5 : 0);
}

/** The 1–2 best skills for a task (free: keyword matching, no AI). */
export function matchSkills(skills: Skill[], task: Record<string, any>, max = 2) {
  const taskWords = words(`${task.title} ${task.instruction} ${task.skill_hint ?? ''}`);
  return skills
    .map((s) => ({ s, score: skillScore(s, taskWords, task.worker) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.s);
}

const UNSAFE = [/ignore (all |any )?(previous|prior|above) instructions/i, /<script/i, /\b(api[_-]?key|password|secret)\s*[:=]/i, /\b(rm -rf|curl [^\n]*\| *(ba)?sh)\b/i];

export function validateSkill(s: Partial<Skill>): { ok: boolean; reason?: string } {
  if (!s?.name || s.name.length > 60) return { ok: false, reason: 'missing or overlong name' };
  if (!s.description || s.description.length > 200) return { ok: false, reason: 'missing or overlong description' };
  if (!s.body || s.body.length < 40) return { ok: false, reason: 'instructions too short' };
  if (new TextEncoder().encode(s.body).length > 4000) return { ok: false, reason: 'skill too large' };
  if (UNSAFE.some((re) => re.test(s.body!))) return { ok: false, reason: 'unsafe content' };
  return { ok: true };
}

/** A near-duplicate of an existing skill (same name, or mostly the same tags)? */
export function findDuplicate(skills: Skill[], candidate: Skill) {
  return skills.find((s) => s.id === candidate.id || (candidate.tags.length > 0 && candidate.tags.filter((t) => s.tags.includes(t)).length / candidate.tags.length >= 0.7));
}

/** Skill file format (also used for skills kept in the Obsidian vault). */
export function parseSkill(text: string, source: string): Skill | null {
  const m = text.replace(/\r/g, '').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = Object.fromEntries(m[1].split('\n').map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((x) => [x![1], x![2].trim()]));
  const list = (v?: string) => (v || '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { id: slug(meta.name || ''), name: meta.name || '', description: meta.description || '', tags: list(meta.tags), workers: list(meta.workers), source, body: m[2].trim() };
}

export const serializeSkill = (s: Skill) =>
  `---\nname: ${s.name}\ndescription: ${s.description}\ntags: ${s.tags.join(', ')}\nworkers: ${s.workers.join(', ')}\nsource: ${s.source ?? 'learned'}\n---\n${s.body}\n`;

// ── Approvals ───────────────────────────────────────────

const KINDS = ['message', 'publish', 'spend', 'delete', 'other'];
const BLOCK = /```approval\s*\n([\s\S]*?)```/g;

export type ApprovalRequest = { kind: string; summary: string; details: string; payload: Record<string, unknown> };

/** Pull ```approval {json}``` requests out of a worker's answer, so they can wait for the owner. */
export function extractApprovals(text: string) {
  const requests: ApprovalRequest[] = [];
  const clean = text.replace(BLOCK, (_, body) => {
    try {
      const r = JSON.parse(body);
      if (!r.summary) return '';
      const kind = KINDS.includes(r.kind) ? r.kind : 'other';
      const payload: Record<string, unknown> = {};
      let details = String(r.details || '');
      if (kind === 'message' && r.to) {
        Object.assign(payload, { to: String(r.to).slice(0, 200), subject: String(r.subject || '').slice(0, 200), body: String(r.body || '').slice(0, 20000) });
        details = `To: ${payload.to}\nSubject: ${payload.subject}\n\n${payload.body}`;
      } else if (kind === 'publish' && /youtube/i.test(String(r.platform || ''))) {
        const tags = Array.isArray(r.tags) ? r.tags.map(String).slice(0, 15) : [];
        Object.assign(payload, { platform: 'youtube', title: String(r.title || r.summary).slice(0, 100), description: String(r.description || '').slice(0, 5000), tags });
        details = `YouTube video (uploads as private)\nTitle: ${payload.title}\n\n${payload.description}${tags.length ? `\n\nTags: ${tags.join(', ')}` : ''}`;
      }
      requests.push({ kind, summary: String(r.summary).slice(0, 300), details: details.slice(0, 20000), payload });
    } catch {
      /* malformed request: ignore it */
    }
    return '';
  });
  return { text: clean.trim(), requests };
}

// ── Gemini ──────────────────────────────────────────────

/** Convert a JSON Schema into the format Gemini's structured output expects. */
export function toGeminiSchema(schema: any): any {
  const out: any = { type: String(schema.type).toUpperCase() };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.required = schema.required ?? Object.keys(schema.properties);
    out.propertyOrdering = Object.keys(schema.properties);
  }
  return out;
}

/**
 * Choose free Flash models from the ones a key can use: the newest stable Flash for
 * normal work, a Flash-Lite for quick jobs. Models change often, so nothing is hardcoded.
 */
export function pickModels(names: string[]) {
  const usable = names.filter((n) => /flash/.test(n) && !/(image|tts|audio|live|embed|vision|thinking|exp|8b|native|robotics|computer)/.test(n));
  const stable = usable.filter((n) => !/preview/.test(n));
  const pool = stable.length ? stable : usable;
  const version = (n: string) => Number(n.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const rank = (list: string[]) => [...list].sort((a, b) => version(b) - version(a) || a.length - b.length);
  const full = rank(pool.filter((n) => !/lite/.test(n)));
  const lite = rank(pool.filter((n) => /lite/.test(n)));
  return { standard: full[0] ?? lite[0] ?? null, fast: lite[0] ?? full[0] ?? null, candidates: [...full, ...lite].slice(0, 8) };
}

/** Strip a ```json fence if the model added one, then parse. */
export function parseJson(text: string) {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
}

// ── Email ───────────────────────────────────────────────

export function base64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const utf8 = (s: string) => base64(new TextEncoder().encode(s));
export const base64url = (s: string) => utf8(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A plain-text email in the format Gmail's API expects (base64url RFC 822). */
export function rawEmail({ to, subject, body }: { to: string; subject: string; body: string }) {
  if (!/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(to)) throw new Error(`Not a valid email address: ${to}`);
  const message = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${utf8(subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    utf8(body).replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');
  return base64url(message);
}

// ── Demo planner (no Gemini key yet): keyword routing, clearly labelled ──

// Order matters: on a tie, the more specific areas win over Gaming and Research.
const KEYWORDS: Record<string, string[]> = {
  content: ['youtube', 'video', 'script', 'thumbnail', 'channel', 'editing', 'tiktok', 'content', 'shorts'],
  finance: ['budget', 'cost', 'costs', 'business', 'analysis', 'price', 'pricing', 'revenue', 'profit', 'finance', 'money', 'market', 'merch'],
  engineering: ['website', 'app', 'code', 'coding', 'api', 'bug', 'react', 'python', 'site', 'software', 'development', 'develop', 'build'],
  automation: ['automate', 'automation', 'schedule', 'organise', 'organize', 'files', 'backup', 'repetitive'],
  assistant: ['remind', 'reminder', 'todo', 'briefing', 'calendar', 'today', 'tomorrow', 'email'],
  gaming: ['game', 'games', 'minecraft', 'server', 'player', 'gaming', 'level', 'roblox', 'steam'],
  research: ['research', 'trend', 'trends', 'discover', 'compare', 'study', 'investigate'],
};

export function demoPlan(text: string, clouds: { id: string; workers: string[] }[], projects: { cloud_id: string; name: string }[]) {
  const clauses = text.split(/,|;|\n|\band also\b|\band\b/i).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 2);
  const tasks = [];
  for (const clause of clauses) {
    const w = clause.toLowerCase().match(/[a-z]+/g) || [];
    const ranked = Object.entries(KEYWORDS).map(([cloud, kws]) => [cloud, w.filter((x) => kws.includes(x)).length] as const).sort((a, b) => b[1] - a[1]);
    if (!ranked[0][1]) continue;
    let cloud = ranked[0][0];
    if (cloud === 'research' && ranked[1][1]) cloud = ranked[1][0]; // "game research" → research worker in Gaming
    const c = clouds.find((x) => x.id === cloud)!;
    const worker = w.some((x) => KEYWORDS.research.includes(x)) && c.workers.includes('research') ? 'research' : c.workers[0];
    tasks.push({ title: clause.charAt(0).toUpperCase() + clause.slice(1, 70), cloud, project: projects.find((p) => p.cloud_id === cloud)?.name ?? '', worker, instruction: clause, needs: [] as number[], tier: 'standard', skill: '' });
  }
  return {
    reply: tasks.length
      ? `(Demo mode) I've split this into ${tasks.length} task${tasks.length > 1 ? 's' : ''} running in parallel: ${tasks.map((t) => t.title).join('; ')}.`
      : "(Demo mode) There's no Gemini key yet, so I can only route work, not answer questions. Try asking for research, a plan or an analysis.",
    tasks: tasks.slice(0, 6),
    schedules: [] as unknown[],
  };
}
