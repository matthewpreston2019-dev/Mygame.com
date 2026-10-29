// Automatic verification: a quick model checks each result against its task
// and writes the one-line summary shown in the world, the briefing and the chat.
import { ask } from './ai.ts';
import { firstSentence } from './logic.ts';

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, issues: { type: 'array', items: { type: 'string' } } },
  required: ['ok', 'summary', 'issues'],
};

/** Returns { ok: true | false | null (could not check), summary, issues, requests }. */
export async function verify(task: Record<string, any>, text: string) {
  if (!text.trim()) return { ok: false, summary: '', issues: ['The result was empty.'], requests: 0 };
  try {
    const { json, requests } = await ask({
      tier: 'fast',
      maxTokens: 1024,
      schema: SCHEMA,
      system: "You check an AI worker's result against its task. Fail it only for real problems: parts of the task missing, invented or clearly wrong facts, broken code, or claims to have sent, published, bought or deleted something.",
      prompt: `Task: ${task.title}\nInstructions: ${task.instruction}\n\nResult${text.length > 6000 ? ' (truncated)' : ''}:\n${text.slice(0, 6000)}\n\nReturn ok, a 1–2 sentence plain summary of the result for the owner, and the issues (empty when ok).`,
      demo: () => ({ json: { ok: true, summary: firstSentence(text), issues: [] } }),
    });
    return { ...(json as { ok: boolean; summary: string; issues: string[] }), requests };
  } catch (err) {
    if ((err as Error).name === 'LimitError') throw err;
    // Checking failed (not the work itself): keep the result, marked as unchecked.
    return { ok: null, summary: firstSentence(text), issues: [], requests: 1 };
  }
}
