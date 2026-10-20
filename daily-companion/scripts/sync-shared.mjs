// Copies the shared logic (planner, stats, coach texts…) from web/js/shared/
// into supabase/functions/_shared/app/ so the server uses exactly the same
// code as the app. Run after editing anything in web/js/shared/, then
// redeploy the Edge Functions:
//   node scripts/sync-shared.mjs
import { cpSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'web', 'js', 'shared');
const to = join(root, 'supabase', 'functions', '_shared', 'app');
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log('Copied', readdirSync(to).join(', '), '→ supabase/functions/_shared/app/');
