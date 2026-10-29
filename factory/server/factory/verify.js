// Automatic verification: a cheap model checks each result against its task
// and writes the one-line summary shown in the world and the briefing.
import { ask } from '../ai/claude.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'summary', 'issues'],
  properties: {
    ok: { type: 'boolean' },
    summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
  },
};

/** Returns { ok: true | false | null (could not check), summary, issues, costUsd }. */
export async function verify(task, text, signal) {
  if (!text.trim()) return { ok: false, summary: '', issues: ['The result was empty.'], costUsd: 0 };
  try {
    const { json, costUsd } = await ask({
      tier: 'fast',
      maxTokens: 1000,
      schema: SCHEMA,
      signal,
      system:
        'You check an AI worker\'s result against its task. Fail it only for real problems: parts of the task missing, invented or clearly wrong facts, broken code, or claims to have sent, published, bought or deleted something.',
      prompt: `Task: ${task.title}\nInstructions: ${task.instruction}\n\nResult${text.length > 6000 ? ' (truncated)' : ''}:\n${text.slice(0, 6000)}\n\nReturn ok, a 1–2 sentence plain summary of the result for the owner, and the issues (empty when ok).`,
      demo: () => ({ json: { ok: true, summary: firstSentence(text), issues: [] } }),
    });
    return { ...json, costUsd };
  } catch (err) {
    if (signal?.aborted || err.name === 'BudgetError') throw err;
    // Checking failed (not the work itself): keep the result, mark it unchecked.
    return { ok: null, summary: firstSentence(text), issues: [], costUsd: 0 };
  }
}

const firstSentence = (text) =>
  text.replace(/^#+.*$/gm, '').replace(/[*_`>#-]/g, '').trim().split(/(?<=[.!?])\s/)[0].slice(0, 220);
