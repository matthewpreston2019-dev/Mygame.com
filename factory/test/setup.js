// Test environment. Import this FIRST in a test file: config is read when modules load.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-test-'));
process.env.DATA_DIR = dataDir;
process.env.FACTORY_DEMO_DELAY_MS ??= '80';
process.env.TRUSTED_SKILL_SOURCES = '';

/** Wait until check() is truthy (or fail after `ms`). */
export async function until(check, ms = 8000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, 15));
  }
}
