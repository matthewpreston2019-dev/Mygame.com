// =============================================================================
// "Build" for Netlify — no bundler, no npm packages.
// Copies web/ to dist/ and stamps the service worker with:
//   - a unique BUILD id (so every deploy refreshes the offline cache)
//   - the list of files to pre-cache for offline use
// Run locally:  node scripts/build.mjs   (then serve the dist/ folder)
// =============================================================================
import { cpSync, readdirSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'web');
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(out)
  .map((p) => relative(out, p).split('\\').join('/'))
  .filter((f) => f !== 'sw.js' && !f.endsWith('.md') && !f.startsWith('icons/splash/'))
  .sort();

// Netlify sets COMMIT_REF; locally we use the time.
const build = `${(process.env.COMMIT_REF || 'local').slice(0, 8)}-${Date.now().toString(36)}`;
const swPath = join(out, 'sw.js');
const sw = readFileSync(swPath, 'utf8')
  .replace("'__BUILD__'", JSON.stringify(build))
  .replace('/*__PRECACHE__*/[]', JSON.stringify(['./', ...files], null, 0));
writeFileSync(swPath, sw);

console.log(`Built ${build}: ${files.length} files pre-cached → dist/`);
