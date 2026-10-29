// Copies the two browser libraries (Three.js and Supabase) from node_modules into app/vendor,
// so the site needs no external CDN. Runs as the Netlify build step: `npm run build`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'app', 'vendor');
const files = {
  'three/three.module.js': 'node_modules/three/build/three.module.js',
  'three/three.core.js': 'node_modules/three/build/three.core.js',
  'three/addons/controls/OrbitControls.js': 'node_modules/three/examples/jsm/controls/OrbitControls.js',
  'three/addons/renderers/CSS2DRenderer.js': 'node_modules/three/examples/jsm/renderers/CSS2DRenderer.js',
  'supabase.js': 'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
};

fs.rmSync(out, { recursive: true, force: true });
for (const [dest, src] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(out, dest)), { recursive: true });
  fs.copyFileSync(path.join(root, src), path.join(out, dest));
}
console.log(`Vendored ${Object.keys(files).length} files into app/vendor`);
