// Builds ABYSS as ONE self-contained HTML page (CSS, JS and fonts inlined)
// for hosting on a static page host. Output: dist-web/abyss.html
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = 'dist-web'
execSync(`npx vite build --outDir ${out} --emptyOutDir`, {
  stdio: 'inherit',
  env: { ...process.env, ARTIFACT: '1', VITE_TARGET: 'artifact' },
})

const assets = join(out, 'assets')
const files = readdirSync(assets)
const js = files.filter((f) => f.endsWith('.js'))
const css = files.filter((f) => f.endsWith('.css'))
if (js.length !== 1) throw new Error(`Expected one JS bundle, got ${js.join(', ')}`)

const script = readFileSync(join(assets, js[0]), 'utf8').replace(/<\/script/gi, '<\\/script')
const styles = css.map((f) => readFileSync(join(assets, f), 'utf8').replace(/<\/style/gi, '<\\/style')).join('\n')
const favicon = 'data:image/svg+xml;base64,' + Buffer.from(readFileSync('public/favicon.svg')).toString('base64')

const page = `<title>ABYSS Deep Trivia</title>
<meta name="description" content="A deep-ocean trivia game: answer correctly, but answer rare.">
<meta name="theme-color" content="#020617">
<link rel="icon" href="${favicon}">
<style>
:root { color-scheme: dark; }
html, body { background: #020814; }
${styles}
</style>
<div id="root"></div>
<script type="module">
${script}
</script>
`
writeFileSync(join(out, 'abyss.html'), page)
console.log(`\nWrote ${out}/abyss.html (${(page.length / 1024).toFixed(0)} KB)`)
