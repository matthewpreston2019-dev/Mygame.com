// Skills: small reusable instruction sets that make workers better at recurring jobs.
//
// Before every task:  1. match a saved skill by keywords (free — no AI call)
//                     2. only for recurring work with no match: look in the Obsidian vault's
//                        Skills folder (trusted source), then 3. write a small new skill.
// New skills are validated before use; at most two are loaded into a prompt.
import { db, must, log } from './db.ts';
import { ask } from './ai.ts';
import { matchSkills, validateSkill, findDuplicate, slug, words, type Skill } from './logic.ts';
import { vaultSkills, saveSkillToVault } from './obsidian.ts';

const allSkills = async (): Promise<Skill[]> => must(await db.from('skills').select('*'));

export async function prepareSkills(task: Record<string, any>): Promise<Skill[]> {
  const skills = await allSkills();
  const found = matchSkills(skills, task);
  if (found.length || !task.skill_hint) return found;

  try {
    const imported = matchSkills(await vaultSkills(), task, 1)[0];
    if (imported && validateSkill(imported).ok) return [findDuplicate(skills, imported) ?? (await store({ ...imported, source: 'imported' }))];
  } catch (err) {
    await log('error', 'skill.vault_failed', { error: (err as Error).message });
  }

  try {
    const created = await createSkill(task);
    return [findDuplicate(skills, created) ?? (await store(created))];
  } catch (err) {
    if ((err as Error).name === 'LimitError') throw err;
    await log('error', 'skill.create_failed', { task: task.id, error: (err as Error).message });
    return [];
  }
}

async function store(skill: Skill) {
  must(await db.from('skills').upsert({ id: skill.id, name: skill.name, description: skill.description, tags: skill.tags, workers: skill.workers, source: skill.source, origin: skill.origin ?? null, body: skill.body }));
  await log('info', 'skill.added', { skill: skill.name, source: skill.source });
  if (skill.source === 'learned') await saveSkillToVault(skill).catch(() => {});
  return skill;
}

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    instructions: { type: 'string' },
  },
  required: ['name', 'description', 'tags', 'instructions'],
};

async function createSkill(task: Record<string, any>): Promise<Skill> {
  const { json } = await ask({
    tier: 'fast',
    maxTokens: 2048,
    schema: SCHEMA,
    system: 'You write small reusable skills for AI workers: a short checklist of how to do a kind of job well. Generic, not about one specific request. No secrets, no links.',
    prompt: `Create a reusable skill named "${task.skill_hint}" for a ${task.worker} worker.\nExample job it should help with: ${task.instruction.slice(0, 400)}\n\nname: 2–5 words. description: one sentence. tags: 3–6 lowercase keywords. instructions: 5–10 concise bullet points (under 1200 characters).`,
    demo: () => ({
      json: {
        name: task.skill_hint,
        description: `How to handle "${task.skill_hint}" jobs well.`,
        tags: [...words(task.skill_hint)].slice(0, 5),
        instructions: '- Restate the goal in one line.\n- Gather only the facts needed.\n- Structure the answer with short headings.\n- End with clear next steps.\n- (Demo mode: simulated skill.)',
      },
    }),
  });
  const j = json as any;
  const skill: Skill = {
    id: slug(j.name),
    name: String(j.name).slice(0, 60),
    description: String(j.description).slice(0, 200),
    tags: (j.tags as string[]).map((t) => t.toLowerCase().trim()).filter(Boolean).slice(0, 6),
    workers: [task.worker],
    source: 'learned',
    body: String(j.instructions).trim(),
  };
  const check = validateSkill(skill);
  if (!check.ok) throw new Error(`generated skill rejected: ${check.reason}`);
  return skill;
}
