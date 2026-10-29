// All settings come from environment variables (see .env.example).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env if present (tiny parser, no dependency). Real env vars win.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  root,
  port: num(env.PORT, 8787),
  host: env.HOST || '127.0.0.1',
  token: env.FACTORY_TOKEN || '',
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  publicDir: path.join(root, 'public'),
  builtinSkillsDir: path.join(root, 'skills'),

  demo: env.FACTORY_DEMO === '1',
  demoDelayMs: num(env.FACTORY_DEMO_DELAY_MS, 1800), // simulated thinking time in demo mode
  hasKey: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
  models: {
    fast: env.MODEL_FAST || 'claude-haiku-5-5',
    standard: env.MODEL_STANDARD || 'claude-sonnet-5-5',
    strong: env.MODEL_STRONG || 'claude-opus-5-5',
  },

  // Defaults only — the live values are editable in Settings and stored in the database.
  defaults: {
    dailyBudgetUsd: num(env.DAILY_BUDGET_USD, 2),
    monthlyBudgetUsd: num(env.MONTHLY_BUDGET_USD, 30),
    maxParallel: num(env.MAX_PARALLEL, 3),
    briefingAt: env.BRIEFING_AT || '08:00',
  },

  reuseDays: num(env.REUSE_DAYS, 7),
  maxAttempts: 3,
  trustedSkillSources: (env.TRUSTED_SKILL_SOURCES || '').split(',').map((s) => s.trim()).filter(Boolean),
};

export const isLoopback = (host) => ['127.0.0.1', 'localhost', '::1'].includes(host);
