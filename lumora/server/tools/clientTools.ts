// Tools whose execution happens in the user's browser. The server only declares them.
import type { ToolDef } from './types';

export const runCodeTool: ToolDef = {
  name: 'run_code',
  client: true,
  risk: 'confirm',
  spec: {
    name: 'run_code',
    description:
      "Run a short Python or JavaScript program in a sandbox inside the user's browser (no network, no file system, 20s limit). The user must approve each run. Print results to stdout. Python has the standard library; numpy/pandas may be loaded on demand.",
    parameters: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['python', 'javascript'] },
        code: { type: 'string', description: 'Complete program to execute' },
      },
      required: ['language', 'code'],
    },
  },
};

export const rememberTool: ToolDef = {
  name: 'remember',
  client: true,
  risk: 'safe',
  spec: {
    name: 'remember',
    description:
      'Save a durable, useful fact or preference about the user to long-term memory (e.g. "Prefers metric units", "Is learning Spanish"). Only use when the user shares something clearly worth remembering for future chats or explicitly asks you to remember. Never store secrets, passwords, financial or health details unless explicitly asked.',
    parameters: {
      type: 'object',
      properties: { fact: { type: 'string', description: 'One concise sentence' } },
      required: ['fact'],
    },
  },
};
