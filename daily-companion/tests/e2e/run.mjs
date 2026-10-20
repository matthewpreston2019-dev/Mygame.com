// =============================================================================
// Browser test: drives the real app (built to dist/) at iPhone size through
// every main flow and saves screenshots to tests/e2e/shots/.
// Supabase is replaced by the in-memory mock (mock-supabase.mjs).
//   node scripts/build.mjs && NODE_PATH=$(npm root -g) node tests/e2e/run.mjs
// =============================================================================
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockSupabase } from './mock-supabase.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', '..', 'dist');
const shots = join(here, 'shots');
await mkdir(shots, { recursive: true });

// ---- static server for dist/ ----------------------------------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/download') p = '/download.html';
  try {
    const buf = await readFile(join(dist, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const mock = createMockSupabase();
const errors = [];
let step = 0;
const log = (msg) => console.log(`✓ ${++step}. ${msg}`);
function fail(msg) { console.error('✗ FAILED:', msg); throw new Error(msg); }

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices['iPhone 13'],            // iPhone viewport, touch, iOS Safari user agent
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  serviceWorkers: 'block',            // SW offline caching is tested separately below
  locale: 'en-GB',
  timezoneId: 'Europe/Berlin',
});
let supabaseDown = false;
await context.route(/supabase\.co/, async (route) => {
  if (supabaseDown) return route.abort('internetdisconnected');
  const r = route.request();
  const res = await mock.handle(r.method(), r.url(), r.headers(), r.postData());
  await route.fulfill({ status: res.status, body: res.body, headers: res.headers });
});
const page = await context.newPage();
// Tuesday 20 Oct 2026, 21:30 in Berlin (a long day, check-in time).
await page.clock.setFixedTime(new Date('2026-10-20T19:30:00Z'));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });

const shot = (name) => page.screenshot({ path: join(shots, `${String(step).padStart(2, '0')}-${name}.png`) });
const click = (sel) => page.locator(sel).first().click();
const text = (t) => page.getByText(t, { exact: false }).first();
const waitText = (t, timeout = 5000) => text(t).waitFor({ timeout });
const sheetClose = () => page.locator('.sheet:not(.closing) .sheet-head .icon-btn').last().click();
const waitSheetsGone = () => page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 4000 });
const button = (name) => page.locator('button:visible', { hasText: name }).last();

try {
  // ---- 1. First visit: install popup + auth -------------------------------------
  await page.goto(BASE + '/');
  await waitText('Create account');
  await waitText('Install the app', 4000);
  await shot('install-popup');
  log('Install popup shows once on first browser visit (iOS steps)');
  await sheetClose(); await waitSheetsGone();

  await button('Create account').click();
  await page.fill('input[type=email]', 'me@example.com');
  await page.fill('input[autocomplete=new-password]', 'short');
  await page.locator('form button[type=submit]').click();
  await waitText('At least 8 characters');
  log('Password validation shows an inline error');
  await page.fill('input[autocomplete=new-password]', 'Secret123!');
  await shot('auth');
  await page.locator('form button[type=submit]').click();
  await waitText('Save your recovery code');
  await waitText('ABCD-EFGH-JKMN-PQRS');
  await shot('recovery-code');
  await button("I've saved it").click();
  log('Account created; recovery code shown once');

  // ---- 2. Onboarding ----------------------------------------------------------------
  await waitText('Welcome', 8000);
  await shot('onboarding-language');
  await button('Continue').click();
  await waitText('You & your goal');
  await page.locator('.field', { hasText: 'Current weight' }).locator('input').fill('78');
  await page.locator('.field', { hasText: 'Height' }).locator('input').fill('180');
  await page.locator('.field', { hasText: 'Age' }).locator('input').fill('17');
  await button('Male').click();
  await waitText('Suggested');
  await shot('onboarding-body');
  await button('Continue').click();
  await waitText('Your week');
  await shot('onboarding-week');
  await button('Continue').click();
  await waitText('Coach notifications');
  await shot('onboarding-notify');
  await button('Maybe later').click();
  await waitText('Good evening', 5000);
  log('Onboarding: language → body (target suggestion) → week → notifications');
  const prof = mock.T('profiles')[0];
  await page.waitForTimeout(800);
  const savedSettings = mock.T('profiles')[0].settings;
  if (!savedSettings.onboarded || savedSettings.targets?.goalWeight !== 69) fail('settings not synced: ' + JSON.stringify(savedSettings));
  if (!mock.T('weights').length) fail('initial weight not logged');
  log(`Settings synced to the server (kcal target ${savedSettings.targets.kcal}, protein ${savedSettings.targets.protein} g)`);
  void prof;

  // ---- 3. Today ------------------------------------------------------------------------
  await waitText('Long day');
  await waitText('Evening check-in');
  await waitText('Light review');
  await shot('today');
  log('Today: long-day plan (light review), evening check-in card, tomorrow card');

  await page.locator('.quest', { hasText: '5 push-ups' }).click();
  await waitText('+10 XP');
  if (!(await page.locator('.quest.done', { hasText: '5 push-ups' }).count())) fail('quest not ticked');
  await shot('quest-done');
  log('Manual quest ticks with XP toast + confetti');

  // ---- 4. Food -------------------------------------------------------------------------
  await button('Log food').click();
  await waitText('Save as favorite');
  await page.locator('.sheet input[placeholder="e.g. Chicken & rice"]').fill('Chicken & rice');
  await page.locator('.sheet .field', { hasText: 'kcal' }).locator('input').fill('650');
  await page.locator('.sheet .field', { hasText: 'Protein' }).locator('input').fill('45');
  await page.locator('.sheet .switch input').check();
  await shot('food-form');
  await button('Log it').click();
  await waitText('Logged Chicken & rice');
  await waitSheetsGone();
  await page.locator('.ring-stat', { hasText: 'kcal' }).getByText('650').waitFor();
  log('Food logged from Today; totals update immediately');

  await page.goto(BASE + '/#/track/food');
  await waitText('650 kcal');
  await button('Log food').click();
  await waitText('Favorites');
  await page.locator('.sheet .li', { hasText: '⭐ Chicken & rice' }).click();
  await waitSheetsGone();
  await waitText('1,300');
  await shot('food-section');
  log('Favorite re-logged in one tap (2 × 650 = 1,300 kcal)');

  // validation
  await button('Log food').click();
  await page.locator('.sheet .field', { hasText: 'kcal' }).locator('input').fill('abc');
  await button('Log it').click();
  await waitText('Required');
  await waitText('Enter a number from 0 to 10,000');
  await shot('food-validation');
  await sheetClose(); await waitSheetsGone();
  log('Food form rejects empty name and non-numeric kcal');

  // ---- 5. Steps ------------------------------------------------------------------------
  await page.goto(BASE + '/#/track/steps');
  await button('Log steps').click();
  await page.locator('.sheet input[inputmode=numeric]').fill('9.240');
  await page.locator('.sheet .btn.primary').click();
  await waitSheetsGone();
  await waitText('Goal hit');
  await shot('steps');
  if (mock.T('steps')[0]?.steps !== 9240 && !(await page.waitForTimeout(800), mock.T('steps')[0]?.steps === 9240)) fail('steps not synced');
  log('Steps: "9.240" parsed as 9240, goal ring + weekly chart, synced');

  // ---- 6. Study ------------------------------------------------------------------------
  await page.goto(BASE + '/#/track/study');
  await waitText('Study timer');
  await button('Add study').click();
  await page.locator('.sheet .chip', { hasText: '45 min' }).click();
  await page.locator('.sheet .btn.primary').click();
  await waitSheetsGone();
  await waitText('45 min / 45 min');
  await shot('study');
  log('Study logged (45 min = long-day goal)');

  // ---- 7. Workout ----------------------------------------------------------------------
  await page.goto(BASE + '/#/track/workout');
  await waitText('Start a workout');
  await page.locator('.li', { hasText: 'Upper' }).click();
  await waitText('Bench press');
  await waitText('First time');
  const bench = page.locator('.ex-card', { hasText: 'Bench press' });
  await bench.locator('input[inputmode=decimal]').nth(0).fill('60');
  await bench.locator('input[inputmode=numeric]').nth(0).fill('8');
  await bench.locator('.tick').nth(0).click();
  await waitText('Rest');
  await bench.locator('input[inputmode=decimal]').nth(1).fill('60');
  await bench.locator('input[inputmode=numeric]').nth(1).fill('7');
  await bench.locator('.tick').nth(1).click();
  await shot('workout-session');
  await page.locator('.screen-head .btn.primary').click();
  await waitText('Workout saved: 2 sets');
  log('Workout: sets logged with rest timer; finish saves');

  await page.locator('.li', { hasText: 'Upper' }).first().click();
  await waitText('Last time');
  const bench2 = page.locator('.ex-card', { hasText: 'Bench press' });
  if ((await bench2.locator('input[inputmode=decimal]').nth(0).getAttribute('placeholder')) !== '60') fail('last session not prefilled');
  await bench2.locator('input[inputmode=decimal]').nth(0).fill('62.5');
  await bench2.locator('.tick').nth(0).click();
  await waitText('New PR!');
  await shot('workout-pr');
  await page.locator('.screen-head .btn.primary').click();
  await waitText('Personal records');
  await waitText('62.5 kg × 8');
  await shot('workout-section');
  log('Progressive overload: last session shown as placeholders; 62.5 kg × 8 → PR');

  // ---- 8. Sleep + weight ---------------------------------------------------------------
  await page.goto(BASE + '/#/track/sleep');
  await button('Log last night').click();
  await waitText('8 h 30 min');
  await page.locator('.sheet .btn.primary').click();
  await waitSheetsGone();
  await waitText('Log at least 3 nights');
  await shot('sleep');
  log('Sleep logged (22:30 → 07:00 = 8 h 30 min); score needs 3 nights');

  await page.goto(BASE + '/#/track/weight');
  await waitText('78');
  await button('Log weight').click();
  await page.locator('.sheet input[inputmode=decimal]').fill('77,6');
  await page.locator('.sheet .btn.primary').click();
  await waitSheetsGone();
  await waitText('77.6');
  await shot('weight');
  log('Weight "77,6" (comma) accepted; goal 69 kg shown');

  // ---- 9. Calendar + planner ------------------------------------------------------------
  await page.goto(BASE + '/#/calendar');
  await waitText('Light review');
  await shot('calendar-day');
  await page.locator('.icon-btn.gold').click();
  await page.locator('.sheet input[placeholder="e.g. Biology exam"]').fill('Biology');
  await page.locator('.sheet .chip', { hasText: 'Exam' }).click();
  await page.locator('.sheet input[type=date]').fill('2026-10-21');
  await page.locator('.sheet input[type=time]').nth(0).fill('09:00');
  await page.locator('.sheet input[type=time]').nth(1).fill('08:00');
  await page.locator('.sheet .btn.primary').click();
  await waitText('End must be after start');
  await page.locator('.sheet input[type=time]').nth(1).fill('10:30');
  await page.locator('.sheet .btn.primary').click();
  await waitSheetsGone();
  log('Event form validates end > start; exam event saved');
  await page.waitForTimeout(600);
  const dp = mock.T('day_plans').find((r) => r.date === '2026-10-21');
  if (!dp?.exam || dp.exam.subject !== 'Biology') fail('exam event did not adapt the plan');
  log('Exam event also marks the planner (plan adapts)');
  await button('Week').click();
  await waitText('20');
  await shot('calendar-week');
  await button('Day').click();

  await page.goto(BASE + '/#/today');
  await waitText('Exam tomorrow: Biology');
  await shot('today-exam-tomorrow');
  log('Today shows "exam tomorrow" and study becomes exam prep (60 min on a long day)');

  await page.locator('.screen-head .badge').click();
  await waitText('Day type');
  await button('Rest day').click();
  await waitText('Nothing scheduled');
  await shot('planner');
  await page.locator('.sheet .btn.primary').click();
  await waitSheetsGone();
  await waitText('Rest day ✎');
  log('Day planner: changed today to a rest day with live preview');
  await page.locator('.screen-head .badge').click();
  await button('Reset').click();
  await waitSheetsGone();
  await waitText('Long day');

  // ---- 10. Check-in + coach -------------------------------------------------------------
  await page.locator('.card', { hasText: 'Evening check-in' }).locator('.btn', { hasText: 'Yes' }).first().click();
  await page.locator('.card', { hasText: 'Evening check-in' }).locator('.btn', { hasText: 'No' }).nth(1).click();
  await page.goto(BASE + '/#/coach');
  await waitText('Yes, I studied');
  await waitText("Rest day anyway");
  await button("What's my plan?").click();
  await waitText('Long day');
  await button('How am I doing today?').click();
  await waitText('Your day:');
  await shot('coach-feed');
  log('Check-in answers appear in the coach chat with honest replies; plan & summary on request');
  await button('Reports').click();
  await waitText('Weekly report');
  await waitText('Gym sessions');
  await shot('coach-reports');
  log('Reports: today + weekly with honest verdict');

  // ---- 11. Profile & settings -------------------------------------------------------------
  await page.goto(BASE + '/#/profile');
  await waitText('Day streak');
  await shot('profile');
  for (const [name, expect] of [['Schedule', 'Day types'], ['Targets & body', 'Daily targets'], ['Quests', 'Add quest'], ['Workout templates', 'New template'], ['Notifications', 'Notify me about'], ['Steps from Apple Health', 'x-steps-token']]) {
    await page.locator('.li', { hasText: name }).first().click();
    await waitText(expect);
    await shot('settings-' + name.split(' ')[0].toLowerCase());
    await sheetClose(); await waitSheetsGone();
  }
  log('All settings sheets open (schedule, targets, quests, templates, notifications, steps shortcut)');

  // schedule edit round-trip
  await page.locator('.li', { hasText: 'Schedule' }).first().click();
  await page.locator('.sheet .field', { hasText: 'Lights out' }).locator('input').fill('22:45');
  await page.locator('.sheet .btn.primary').last().click();
  await waitSheetsGone();
  await page.waitForTimeout(600);
  if (mock.T('profiles')[0].settings.schedule?.lightsOut !== '22:45') fail('schedule not saved');
  log('Schedule edit saved and synced');

  // language → Arabic (RTL)
  await page.locator('.li', { hasText: 'Language' }).click();
  await page.locator('.sheet .li', { hasText: 'العربية' }).click();
  await page.waitForFunction(() => document.documentElement.dir === 'rtl');
  await page.goto(BASE + '/#/today');
  await page.waitForTimeout(300);
  await shot('rtl-arabic-today');
  log('Arabic switches the whole layout to right-to-left');
  await page.goto(BASE + '/#/profile');
  await page.locator('.list .li').nth(6).click();
  await page.locator('.sheet .li', { hasText: 'English' }).click();
  await page.waitForFunction(() => document.documentElement.dir === 'ltr');

  // light theme
  await button('Light').click();
  await page.goto(BASE + '/#/today');
  await page.waitForTimeout(300);
  await shot('light-theme');
  await page.goto(BASE + '/#/profile');
  await button('Dark').click();
  log('Light/dark theme switch');

  // ---- 12. Offline queue -------------------------------------------------------------------
  const foodsBefore = mock.T('foods').length;
  supabaseDown = true;
  await context.setOffline(true);
  await page.goto(BASE + '/#/track/food').catch(() => {});
  await page.evaluate(() => { location.hash = '#/track/food'; });
  await button('Log food').click();
  await page.locator('.sheet input[placeholder="e.g. Chicken & rice"]').fill('Offline yogurt');
  await page.locator('.sheet .field', { hasText: 'kcal' }).locator('input').fill('150');
  await page.locator('.sheet .field', { hasText: 'Protein' }).locator('input').fill('20');
  await button('Log it').click();
  await waitSheetsGone();
  await waitText('Offline yogurt');
  await waitText('Offline — everything you log is saved');
  await shot('offline');
  if (mock.T('foods').length !== foodsBefore) fail('should not reach server while offline');
  log('Offline: food saved locally, banner shown, nothing sent');
  supabaseDown = false;
  await context.setOffline(false);
  await page.waitForFunction((n) => true, foodsBefore);
  for (let i = 0; i < 20 && mock.T('foods').length === foodsBefore; i++) await page.waitForTimeout(250);
  if (!mock.T('foods').some((f) => f.name === 'Offline yogurt')) fail('offline change did not sync after reconnect');
  log('Back online: queued change uploaded automatically');

  // ---- 13. Server down → app still opens with local data -------------------------------------
  supabaseDown = true;
  await page.reload();
  await waitText('Offline yogurt', 8000);
  log('Reload with Supabase unreachable: app opens instantly from the device cache');
  supabaseDown = false;

  // ---- 14. Sign out --------------------------------------------------------------------------
  await page.goto(BASE + '/#/profile');
  await page.locator('.li', { hasText: 'Sign out' }).click();
  await page.locator('.sheet .btn.danger').click();
  await waitText('Create account', 5000);
  log('Sign out clears the device and returns to sign-in');
  await page.fill('input[type=email]', 'me@example.com');
  await page.fill('input[autocomplete=current-password]', 'Secret123!');
  await page.locator('form button[type=submit]').click();
  await waitText('Good evening', 8000);
  await page.goto(BASE + '/#/track/food');
  await waitText('Offline yogurt', 8000);
  log('Signing back in downloads everything again from Supabase');

  // ---- 15. Install page ------------------------------------------------------------------------
  await page.goto(BASE + '/download');
  await waitText('Install on iPhone');
  await shot('download-ios');
  const desktop = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await desktop.goto(BASE + '/download');
  await desktop.getByText('Open on your phone').waitFor();
  await desktop.screenshot({ path: join(shots, 'download-desktop.png') });
  await desktop.close();
  log('download.html: iPhone instructions on iOS, "open on phone" on desktop');

  if (errors.length) fail('Console/page errors:\n' + errors.join('\n'));
  log('No JavaScript errors during the whole run');
  console.log('\nALL E2E CHECKS PASSED');
} catch (e) {
  await shot('FAILURE').catch(() => {});
  console.error(e.message);
  if (errors.length) console.error('Errors seen:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
