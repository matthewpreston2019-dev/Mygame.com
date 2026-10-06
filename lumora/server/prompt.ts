import { MODES } from '../shared/modes';
import type { BuiltInModeId, ChatRequestBody, CustomModeDef, ToolName } from '../shared/types';
import { env } from './env';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
  ja: 'Japanese', zh: 'Chinese', ko: 'Korean', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', pl: 'Polish',
  sv: 'Swedish', uk: 'Ukrainian',
};

const clip = (s: string | undefined, n: number) => (s ? s.slice(0, n) : '');

export function buildSystemPrompt(opts: {
  body: ChatRequestBody;
  mode: BuiltInModeId | 'custom';
  customMode?: CustomModeDef;
  tools: ToolName[];
  finalStep: boolean;
}): string {
  const { body, mode, customMode, tools, finalStep } = opts;
  const now = new Date();
  const tz = body.timezone || 'UTC';
  let localTime = now.toISOString();
  try {
    localTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(now);
  } catch {
    /* invalid tz → UTC ISO */
  }

  const sections: string[] = [];
  sections.push(
    `You are ${env.appName}, a personal AI assistant. Current date/time for the user: ${localTime} (${tz}).`,
    'Format answers in GitHub-flavoured Markdown. Use fenced code blocks with language tags for code and LaTeX ($...$, $$...$$) for math.',
    'Be honest about uncertainty and never fabricate facts, quotes, sources or tool results.',
  );

  // Language: an explicit request in the message always wins; otherwise mirror the user.
  const lang = body.language && body.language !== 'auto' ? (LANGUAGE_NAMES[body.language] ?? body.language) : null;
  sections.push(
    lang
      ? `Reply in ${lang} by default. If the user explicitly asks for a different language (e.g. "answer in French", "日本語で答えてください"), use that language instead.`
      : 'Reply in the language the user writes in. If the user explicitly asks for a specific language, use that language.',
  );

  if (mode === 'custom' && customMode) {
    sections.push(`## Mode: ${clip(customMode.name, 80)}`, clip(customMode.instructions, 8000));
    if (customMode.personality) sections.push(`Personality: ${clip(customMode.personality, 1000)}`);
  } else if (mode !== 'custom') {
    sections.push(`## Mode: ${MODES[mode].label}`, MODES[mode].prompt);
  }

  const ci = body.instructions;
  if (ci?.enabled) {
    const lines = [
      ci.name && `- The user's name is ${clip(ci.name, 80)}.`,
      ci.responseStyle && `- Preferred response style: ${clip(ci.responseStyle, 500)}`,
      ci.language && ci.language !== 'auto' && `- Preferred language: ${clip(LANGUAGE_NAMES[ci.language] ?? ci.language, 50)}`,
      ci.technicalLevel && `- Technical level: ${clip(ci.technicalLevel, 200)}`,
      ci.personality && `- Desired assistant personality: ${clip(ci.personality, 500)}`,
      ci.about && `- About the user: ${clip(ci.about, 2000)}`,
      ci.avoid && `- Avoid: ${clip(ci.avoid, 1000)}`,
    ].filter(Boolean);
    if (lines.length) sections.push('## User preferences (custom instructions)', ...(lines as string[]));
  }

  if (body.projectInstructions?.trim()) sections.push('## Project instructions', clip(body.projectInstructions, 6000));

  if (body.memoryEnabled && body.memories?.length) {
    sections.push(
      '## Things you remember about the user',
      ...body.memories.slice(0, 100).map((m) => `- ${clip(m, 300)}`),
      'Use these only when relevant; do not recite them unprompted.',
    );
  }

  if (tools.length) {
    const hints: string[] = ['## Tools', 'Use tools when they materially improve accuracy; do not call tools for things you can answer reliably yourself.'];
    if (tools.includes('web_search')) hints.push('After using web_search or read_url, cite sources inline with their bracketed numbers like [1]. Only cite numbers that appeared in tool results.');
    if (tools.includes('remember')) hints.push('Use `remember` sparingly for durable preferences/facts; tell the user briefly when you save something.');
    if (tools.includes('run_code')) hints.push('`run_code` executes in the user\'s browser after they approve it; keep programs short and print the results.');
    sections.push(...hints);
  }

  if (body.agent) {
    sections.push(
      '## Agent mode',
      'Work autonomously toward the user\'s goal: (1) restate the goal briefly, (2) write a short numbered plan, (3) execute it step by step using tools, (4) check the results against the goal and fix problems, (5) finish with a concise report of what was done, findings and any remaining issues.',
      'You may only act through the provided tools. Never claim to have performed actions you did not perform.',
    );
  }

  if (finalStep) sections.push('IMPORTANT: The tool-use limit for this answer has been reached. Do not call any more tools; give your best final answer now using the information gathered.');

  return sections.join('\n\n');
}
