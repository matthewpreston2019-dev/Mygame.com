// Renders web/icons/icon.svg into every PNG size the PWA needs, plus iPhone
// splash screens. Only needed if you change the icon design.
//
// Run (needs Playwright + Chromium, which the dev container has):
//   NODE_PATH=$(npm root -g) node scripts/render-icons.mjs
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// createRequire honours NODE_PATH, so a globally installed Playwright works.
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const svg = readFileSync(join(root, 'icons', 'icon.svg'), 'utf8');
const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const out = join(root, 'icons');
mkdirSync(join(out, 'splash'), { recursive: true });

// [file, size, rounded corners?]
// "rounded" icons have transparent corners (desktop / Android "any" purpose).
// Full-bleed ones are for iOS (it rounds them itself) and Android maskable.
const ICONS = [
  ['icon-192.png', 192, true],
  ['icon-512.png', 512, true],
  ['maskable-192.png', 192, false],
  ['maskable-512.png', 512, false],
  ['apple-touch-icon.png', 180, false],
  ['favicon-32.png', 32, true],
  ['favicon-16.png', 16, true],
];

// iPhone portrait splash screens: [css width, css height, device pixel ratio]
const SPLASH = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3],
  [390, 844, 3], [414, 896, 3], [375, 812, 3], [414, 896, 2], [375, 667, 2],
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const [file, size, rounded] of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">
    <img src="${dataUrl}" style="width:${size}px;height:${size}px;display:block;
      ${rounded ? `border-radius:${size * 0.225}px;` : ''}"></body></html>`);
  await page.screenshot({ path: join(out, file), omitBackground: true });
  console.log('icon', file);
}

for (const [w, h, dpr] of SPLASH) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const p = await ctx.newPage();
  const icon = Math.round(w * 0.32);
  await p.setContent(`<html><body style="margin:0;height:100vh;background:#0B1F16;display:flex;
      flex-direction:column;align-items:center;justify-content:center;
      font-family:-apple-system,system-ui,sans-serif">
    <img src="${dataUrl}" style="width:${icon}px;height:${icon}px;border-radius:${icon * 0.225}px">
    <div style="margin-top:22px;color:#C4DDBA;font-size:20px;font-weight:600;letter-spacing:.3px">Daily Companion</div>
  </body></html>`);
  const name = `splash-${w * dpr}x${h * dpr}.png`;
  await p.screenshot({ path: join(out, 'splash', name) });
  await ctx.close();
  console.log('splash', name);
}

await browser.close();
