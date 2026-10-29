// What one worker does with one task:
//   skills → context → work → verify (→ one revision) → save → approvals → Obsidian note / email
import { db, must, getTask, updateTask, getSettings, now, log } from './db.ts';
import { ask } from './ai.ts';
import { WORKERS, extractApprovals, firstSentence, type Skill } from './logic.ts';
import { prepareSkills } from './skills.ts';
import { verify } from './verify.ts';
import { createApproval } from './approvals.ts';
import { relevantNotes, saveNote } from './obsidian.ts';
import { sendEmail, youtubeStats } from './google.ts';

const RULES = `Rules:
- Lead with the answer. Be concise and practical; no filler or repetition.
- Use Markdown with short headings and lists where they help.
- Never claim to have done something you cannot do. You cannot send messages, publish, spend money or delete files yourself.
- If the task needs one of those actions, prepare it completely, then end with one block per action. The owner approves or rejects it.
  Email:   \`\`\`approval
           {"kind": "message", "summary": "one line", "to": "name@example.com", "subject": "…", "body": "the full email"}
           \`\`\`
  YouTube: \`\`\`approval
           {"kind": "publish", "platform": "youtube", "summary": "one line", "title": "…", "description": "…", "tags": ["…"]}
           \`\`\`
  Other:   \`\`\`approval
           {"kind": "spend | delete | other", "summary": "one line", "details": "exactly what will happen"}
           \`\`\``;

export async function runTask(id: string) {
  const task = await getTask(id);
  if (!task || task.status !== 'running') return;
  const settings = await getSettings();
  const def = WORKERS[task.worker] ?? WORKERS.assistant;
  const [cloud, project] = await Promise.all([
    must(await db.from('clouds').select('name').eq('id', task.cloud_id).single()),
    task.project_id ? must(await db.from('projects').select('name').eq('id', task.project_id).maybeSingle()) : null,
  ]);
  let requests = 0;

  await updateTask(id, { progress: 12, stage: 'Checking skills' });
  const skills = await prepareSkills(task);

  await updateTask(id, { progress: 25, stage: 'Gathering context', skill_ids: skills.map((s) => s.id) });
  const prompt = `Task: ${task.title}\nArea: ${cloud.name} › ${project?.name ?? 'Inbox'}\n\n${task.instruction.replace('{{briefing}}', '')}${await context(task, skills)}`;
  const system = `${def.role}\n\n${RULES}`;
  const demo = () => ({ text: demoResult(task, def.name) });

  await updateTask(id, { progress: 35, stage: skills.length ? `Working · ${skills.map((s) => s.name).join(', ')}` : 'Working' });
  let out = await ask({ tier: task.tier === 'fast' ? 'fast' : 'standard', system, prompt, web: def.web, maxTokens: 8192, demo });
  requests += out.requests;

  let check: { ok: boolean | null; summary: string; issues: string[]; requests?: number } = { ok: null, summary: firstSentence(out.text), issues: [] };
  if (settings.verify_results) {
    await updateTask(id, { progress: 78, stage: 'Verifying', requests });
    check = await verify(task, out.text);
    requests += check.requests ?? 0;
    if (check.ok === false) {
      await updateTask(id, { progress: 84, stage: 'Revising', requests });
      const revised = await ask({ tier: 'standard', system, prompt: `${prompt}\n\nA reviewer found these problems in your previous answer:\n- ${check.issues.join('\n- ')}\n\nWrite the complete, corrected answer.`, web: def.web, maxTokens: 8192, demo });
      out = { ...revised, sources: [...out.sources, ...revised.sources] };
      check = await verify(task, out.text);
      requests += revised.requests + (check.requests ?? 0);
    }
  }

  // Cancelled while working? Then don't overwrite it.
  if ((await getTask(id))?.status !== 'running') return;

  const { text, requests: approvalRequests } = extractApprovals(out.text);
  const sources = out.sources.length ? `\n\n## Sources\n${out.sources.map((s: any) => `- [${s.title}](${s.url})`).join('\n')}` : '';
  const warning = check.ok === false ? `> ⚠ Needs review: ${check.issues.join('; ')}\n\n` : '';
  const result = `${warning}${text}${sources}`;

  await updateTask(id, {
    status: 'done',
    progress: 100,
    stage: check.ok === true ? 'Verified' : check.ok === false ? 'Done · needs your review' : 'Done',
    verified: check.ok,
    issues: check.ok === false ? check.issues : [],
    summary: check.summary,
    result,
    sources: out.sources,
    model: out.model,
    requests,
    finished_at: now(),
  });
  for (const r of approvalRequests) await createApproval(task, r);
  await log('info', 'task.done', { task: id, title: task.title, worker: task.worker, model: out.model, requests, verified: check.ok });

  await afterDone({ ...task, verified: check.ok }, cloud.name, project?.name ?? 'Inbox', result, settings);
}

/** Extra context, gathered without AI calls: shared results, earlier work, your notes, channel stats. */
async function context(task: Record<string, any>, skills: Skill[]) {
  const parts: string[] = [];

  if (skills.length) parts.push('Skills to apply:', ...skills.map((s) => `### ${s.name}\n${s.body}`));

  if (task.depends_on.length) {
    const shared = must(await db.from('tasks').select('id,title,result,summary,reused_from').in('id', task.depends_on));
    parts.push('Results shared by other workers (use them, do not redo them):');
    for (const d of shared) parts.push(`### ${d.title}\n${(await resultOf(d)).slice(0, 2500)}`);
  }

  const earlier = must(await db.from('tasks').select('title,summary').eq('project_id', task.project_id).eq('status', 'done').neq('summary', '').neq('id', task.id).order('finished_at', { ascending: false }).limit(3));
  if (earlier.length) parts.push('Earlier work in this project (build on it, do not repeat it):', ...earlier.map((t: any) => `- ${t.title}: ${t.summary}`));

  const notes = await relevantNotes(`${task.title} ${task.instruction}`).catch(() => []);
  if (notes.length) parts.push("From the owner's Obsidian notes (their second brain):", ...notes.map((n) => `### ${n.path}\n${n.text}`));

  if ((task.cloud_id === 'content' || task.worker === 'content') && /youtube|channel|views|subscriber|analytics|video/i.test(`${task.title} ${task.instruction}`)) {
    const stats = await youtubeStats().catch(() => null);
    if (stats) parts.push('Live YouTube channel data:', stats);
  }

  if (task.schedule_id && task.instruction.includes('{{briefing}}')) parts.push(await briefingData());
  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}

const resultOf = async (t: Record<string, any>) =>
  t.reused_from ? (must(await db.from('tasks').select('result').eq('id', t.reused_from).maybeSingle())?.result ?? t.summary) : (t.result ?? t.summary);

/** The briefing is built from the factory's own records, so it costs one small AI call. */
async function briefingData() {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [done, failed, pending, s] = await Promise.all([
    must(await db.from('tasks').select('title,summary').eq('status', 'done').gt('finished_at', since).neq('summary', '').is('schedule_id', null).limit(15)),
    must(await db.from('tasks').select('title,error').eq('status', 'failed').gt('finished_at', since).limit(10)),
    must(await db.from('approvals').select('kind,summary').eq('status', 'pending').limit(10)),
    getSettings(),
  ]);
  return [
    `Finished in the last 24h:\n${done.map((t: any) => `- ${t.title}: ${t.summary}`).join('\n') || '- nothing'}`,
    `Failed:\n${failed.map((t: any) => `- ${t.title}: ${t.error}`).join('\n') || '- nothing'}`,
    `Waiting for my approval:\n${pending.map((a: any) => `- ${a.kind}: ${a.summary}`).join('\n') || '- nothing'}`,
    `AI requests used today: ${s.requests_today} of ${s.daily_request_limit}.`,
  ].join('\n\n');
}

/** Save to the Obsidian vault and email briefings. Never fails the task. */
async function afterDone(task: Record<string, any>, cloudName: string, projectName: string, result: string, settings: Record<string, any>) {
  try {
    const path = await saveNote(task, cloudName, projectName, `# ${task.title}\n\n${result}`);
    if (path) await updateTask(task.id, { note_path: path });
  } catch (err) {
    await log('error', 'obsidian.save_failed', { task: task.id, error: (err as Error).message });
  }
  if (task.schedule_id && task.instruction.includes('{{briefing}}') && settings.email_briefings && settings.google?.connected) {
    try {
      await sendEmail({ to: settings.owner_email, subject: `Your factory briefing · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, body: result });
      await log('info', 'briefing.emailed', { to: settings.owner_email });
    } catch (err) {
      await log('error', 'briefing.email_failed', { error: (err as Error).message });
    }
  }
}

function demoResult(task: Record<string, any>, workerName: string) {
  return `**Demo mode: simulated output. Add your free Gemini key in Settings → AI for real results.**

## ${task.title}

${workerName} would handle this:

> ${String(task.instruction).replace('{{briefing}}', '').slice(0, 300)}

- Step 1: clarify the goal and constraints
- Step 2: gather what is needed
- Step 3: produce the deliverable and next steps`;
}
