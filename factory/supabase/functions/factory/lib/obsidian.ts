// Obsidian as the factory's second brain, through a private GitHub repo that holds your vault
// (synced on your PC and iPhone with the free "Obsidian Git" plugin).
//
//   write  every finished result becomes a note:  <folder>/<Cloud>/<Project>/<date> <title>.md
//   read   the 2 most relevant notes are given to workers as context
//   skills <folder>/Skills/*.md are trusted skills; skills the factory learns are saved there too
import { getSecret, setSecret, deleteSecret, getSettings, updateSettings, HttpError } from './db.ts';
import { words, overlap, safeName, parseSkill, serializeSkill, base64, type Skill } from './logic.ts';

async function vault() {
  const s = await getSettings();
  const ghToken = await getSecret('github_token');
  if (!s.obsidian?.connected || !ghToken) return null;
  return { repo: s.obsidian.repo as string, folder: s.obsidian.folder as string, branch: s.obsidian.branch as string, token: ghToken };
}

async function gh(token: string, path: string, init: RequestInit = {}, accept = 'application/vnd.github+json') {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'worker-factory', ...init.headers },
  });
  if (!res.ok) throw new HttpError(res.status === 404 ? 400 : 502, `GitHub ${res.status}: ${(await res.json().catch(() => ({})))?.message ?? ''}`);
  return accept.endsWith('raw') ? res.text() : res.json();
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

// ── Connecting ──────────────────────────────────────────

export async function connect(repo: string, ghToken: string, folder = 'Factory') {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new HttpError(400, 'Repository should look like username/my-vault');
  const info = await gh(ghToken, `/repos/${repo}`);
  if (!info.permissions?.push) throw new HttpError(400, 'That token can read the repository but not write to it. Give it "Contents: Read and write".');
  await setSecret('github_token', ghToken);
  await updateSettings({ obsidian: { connected: true, repo, folder: safeName(folder) || 'Factory', branch: info.default_branch, private: info.private } });
  tree = null;
}

export async function disconnect() {
  await deleteSecret('github_token');
  await updateSettings({ obsidian: { connected: false } });
}

// ── Writing ─────────────────────────────────────────────

async function putFile(v: NonNullable<Awaited<ReturnType<typeof vault>>>, path: string, content: string, message: string) {
  let sha: string | undefined;
  try {
    sha = (await gh(v.token, `/repos/${v.repo}/contents/${encodePath(path)}?ref=${v.branch}`)).sha;
  } catch {
    /* new file */
  }
  await gh(v.token, `/repos/${v.repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: base64(new TextEncoder().encode(content)), branch: v.branch, ...(sha && { sha }) }),
  });
}

/** Save a finished result as a note. Returns its path in the vault, or null if no vault is connected. */
export async function saveNote(task: Record<string, any>, cloudName: string, projectName: string, markdown: string) {
  const v = await vault();
  if (!v) return null;
  const date = new Date().toISOString().slice(0, 10);
  const path = `${v.folder}/${safeName(cloudName)}/${safeName(projectName)}/${date} ${safeName(task.title)} (${task.id.slice(0, 4)}).md`;
  const frontmatter = [
    '---',
    `tags: [factory, ${cloudName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}]`,
    `worker: ${task.worker}`,
    `created: ${new Date().toISOString()}`,
    `verified: ${task.verified ?? 'unchecked'}`,
    '---',
    '',
  ].join('\n');
  await putFile(v, path, `${frontmatter}${markdown}\n\n---\nArea: [[${safeName(cloudName)}]] · Project: [[${safeName(projectName)}]]\n`, `Factory: ${task.title}`);
  tree = null;
  return path;
}

export async function saveSkillToVault(skill: Skill) {
  const v = await vault();
  if (v) await putFile(v, `${v.folder}/Skills/${safeName(skill.name)}.md`, serializeSkill(skill), `Factory skill: ${skill.name}`);
}

// ── Reading ─────────────────────────────────────────────

let tree: { at: number; paths: string[] } | null = null;

async function notePaths(v: NonNullable<Awaited<ReturnType<typeof vault>>>): Promise<string[]> {
  if (tree && Date.now() - tree.at < 10 * 60_000) return tree.paths;
  const data = await gh(v.token, `/repos/${v.repo}/git/trees/${v.branch}?recursive=1`);
  const paths = (data.tree ?? []).filter((e: any) => e.type === 'blob' && e.path.endsWith('.md') && !e.path.startsWith('.')).map((e: any) => e.path);
  tree = { at: Date.now(), paths };
  return paths;
}

const readNote = (v: NonNullable<Awaited<ReturnType<typeof vault>>>, path: string) =>
  gh(v.token, `/repos/${v.repo}/contents/${encodePath(path)}?ref=${v.branch}`, {}, 'application/vnd.github.raw') as Promise<string>;

/** The notes most related to a task, by matching words in their titles and folders (no AI). */
export async function relevantNotes(text: string, max = 2) {
  const v = await vault();
  if (!v) return [];
  const want = words(text);
  const ranked = (await notePaths(v))
    .filter((p) => !p.startsWith(`${v.folder}/Skills/`))
    .map((p) => ({ p, score: overlap(words(p.replace(/\.md$/, '').replace(/[/_-]/g, ' ')), want) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
  return Promise.all(ranked.map(async ({ p }) => ({ path: p, text: (await readNote(v, p)).slice(0, 1500) })));
}

/** Skills you keep in your vault (<folder>/Skills) — a trusted source the factory may import from. */
export async function vaultSkills(): Promise<Skill[]> {
  const v = await vault();
  if (!v) return [];
  const paths = (await notePaths(v)).filter((p) => p.startsWith(`${v.folder}/Skills/`)).slice(0, 30);
  const skills = await Promise.all(paths.map(async (p) => parseSkill(await readNote(v, p), 'imported')));
  return skills.filter((s): s is Skill => Boolean(s)).map((s) => ({ ...s, origin: `obsidian:${v.repo}` }));
}
