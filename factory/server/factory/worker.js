// What a single worker does with a task:
//   skills → work → verify (→ one revision if needed) → save result → request approvals
import { db, findCloud, findProject, findTask, resultPathFor, writeResult, readResult, now } from '../core/store.js';
import { log } from '../core/log.js';
import { ask } from '../ai/claude.js';
import { WORKERS } from './world.js';
import { prepareSkills } from './skills.js';
import { verify } from './verify.js';
import { extractApprovals, createApproval } from './approvals.js';
import { updateTask } from './tasks.js';

const RULES = `Rules:
- Lead with the answer. Be concise and practical; no filler or repetition.
- Use Markdown with short headings and lists where they help.
- Never claim to have done something you cannot do. You cannot send messages, publish, spend money or delete files.
- If the task needs one of those actions, prepare it completely, then end with exactly one block per action:
\`\`\`approval
{"kind": "message | publish | spend | delete | other", "summary": "one line", "details": "what exactly will happen"}
\`\`\`
The owner approves or rejects it.`;

export async function runTask(task, signal) {
  const def = WORKERS[task.worker] || WORKERS.assistant;
  const tier = task.tier || def.tier;

  updateTask(task, { progress: 12, stage: 'Checking skills' });
  const skills = await prepareSkills(task, signal);

  updateTask(task, { progress: 30, stage: skills.length ? `Working · ${skills.map((s) => s.name).join(', ')}` : 'Working', skillIds: skills.map((s) => s.id) });
  const system = `${def.role}\n\n${RULES}`;
  const prompt = buildPrompt(task, skills);
  const demo = () => ({ text: demoResult(task, def) });

  let out = await ask({ tier, system, prompt, web: def.web, signal, maxTokens: 8000, demo });
  let cost = out.costUsd;

  updateTask(task, { progress: 78, stage: 'Verifying' });
  let check = await verify(task, out.text, signal);
  cost += check.costUsd;

  if (check.ok === false) {
    updateTask(task, { progress: 84, stage: 'Revising' });
    const fix = `${prompt}\n\nA reviewer found these problems in your previous answer:\n- ${check.issues.join('\n- ')}\n\nWrite the complete, corrected answer.`;
    const revised = await ask({ tier, system, prompt: fix, web: def.web, signal, maxTokens: 8000, demo });
    out = { ...revised, sources: [...out.sources, ...revised.sources] };
    check = await verify(task, out.text, signal);
    cost += revised.costUsd + check.costUsd;
  }

  signal.throwIfAborted();
  const { text, requests } = extractApprovals(out.text);
  const resultPath = resultPathFor(task);
  writeResult(resultPath, renderResult(task, text, out.sources, check));
  for (const r of requests) createApproval(task, r);

  updateTask(task, {
    status: 'done',
    progress: 100,
    stage: check.ok === true ? 'Verified' : check.ok === false ? 'Done · needs your review' : 'Done · not checked',
    verified: check.ok,
    issues: check.ok === false ? check.issues : [],
    summary: check.summary,
    resultPath,
    sources: out.sources,
    model: out.model,
    costUsd: Math.round((task.costUsd + cost) * 10000) / 10000,
    finishedAt: now(),
  });
  log.info('task.done', { task: task.id, title: task.title, worker: task.worker, model: out.model, costUsd: task.costUsd, verified: check.ok });
}

function buildPrompt(task, skills) {
  const cloud = findCloud(task.cloudId);
  const project = findProject(task.projectId);
  const parts = [`Task: ${task.title}`, `Area: ${cloud?.name} › ${project?.name || 'Inbox'}`, '', task.instruction];

  if (skills.length) {
    parts.push('', 'Skills to apply:', ...skills.map((s) => `### ${s.name}\n${s.body}`));
  }

  // Results shared by the tasks this one depends on.
  const shared = task.dependsOn.map(findTask).filter((d) => d?.resultPath);
  if (shared.length) {
    parts.push('', 'Results shared by other workers (use them, do not redo them):');
    for (const d of shared) parts.push(`### ${d.title}\n${(readResult(d.resultPath) || d.summary).slice(0, 2500)}`);
  }

  // Earlier finished work in the same project — reuse instead of repeating.
  const earlier = db.tasks
    .filter((t) => t.projectId === task.projectId && t.status === 'done' && t.id !== task.id && !task.dependsOn.includes(t.id) && t.summary)
    .slice(-3);
  if (earlier.length) {
    parts.push('', 'Earlier work in this project (build on it, do not repeat it):', ...earlier.map((t) => `- ${t.title}: ${t.summary}`));
  }
  return parts.join('\n');
}

function renderResult(task, text, sources, check) {
  const project = findProject(task.projectId);
  const header = [
    `# ${task.title}`,
    '',
    `> ${findCloud(task.cloudId)?.name} › ${project?.name || 'Inbox'} · ${WORKERS[task.worker]?.name} · ${new Date().toLocaleString('en-GB')}`,
  ];
  if (check.ok === false) header.push(`> ⚠ Needs review: ${check.issues.join('; ')}`);
  const footer = sources.length ? ['', '## Sources', ...sources.map((s) => `- [${s.title}](${s.url})`)] : [];
  return [...header, '', text, ...footer, ''].join('\n');
}

function demoResult(task, def) {
  return `**Demo mode — simulated output. Add an ANTHROPIC_API_KEY for real results.**

## ${task.title}

${def.name} would handle this:

> ${task.instruction.slice(0, 300)}

- Step 1: clarify the goal and constraints
- Step 2: gather what is needed
- Step 3: produce the deliverable and next steps`;
}
