/**
 * Playwright helpers for visual checks against the Vite DEV server (not the production build: they import
 * app modules by their /src/… URLs).
 *
 * Usage (Playwright is installed globally):
 *
 *   // script.cjs — run with: NODE_PATH=/opt/node22/lib/node_modules node script.cjs
 *   const { launch, passGates, seedDemos, resetDb, shot } = require('/home/user/mindmap-share/shiori-cho/scripts/e2e/helpers.cjs');
 *   (async () => {
 *     const base = 'http://localhost:5301/';
 *     const { browser, page, errors } = await launch();       // 360×780, ja-JP, console/page errors collected
 *     await resetDb(page, base);                             // optional: start from an empty device
 *     await passGates(page, base);                           // age gate + onboarding done, app shell visible
 *     await seedDemos(page, base);                           // サンプルA / サンプルB imported
 *     await page.goto(base + '#/code');
 *     await shot(page, '/tmp/…/shots/me/code.png');
 *     console.log(errors);                                   // must be empty
 *     await browser.close();
 *   })();
 *
 * Shell states carry data-shell="loading|error|age-gate|onboarding|lock|camouflage|app" so scripts can wait
 * for them, e.g. `await page.waitForSelector('[data-shell="app"]')`.
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function playwright() {
  try {
    return require('playwright');
  } catch {
    return require('/opt/node22/lib/node_modules/playwright');
  }
}

/**
 * Launches Chromium with a 360×780 ja-JP context (override with opts.viewport / opts.colorScheme /
 * opts.reducedMotion / opts.context). `errors` collects console errors and page errors (strings).
 */
async function launch(opts = {}) {
  const { chromium } = playwright();
  const browser = await chromium.launch({ executablePath: CHROMIUM, ...(opts.launch || {}) });
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 360, height: 780 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    colorScheme: opts.colorScheme || 'light',
    reducedMotion: opts.reducedMotion || 'no-preference',
    ...(opts.context || {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return { browser, context, page, errors };
}

function sameDocument(url) {
  const u = new URL(url);
  u.hash = '';
  return u.toString();
}

/** Loads baseUrl (keeping any hash) if the page is not already on that document. */
async function ensureLoaded(page, baseUrl) {
  const current = page.url();
  if (current === 'about:blank' || sameDocument(current) !== sameDocument(baseUrl)) {
    await page.goto(baseUrl);
  }
  await page.waitForSelector('[data-shell]:not([data-shell="loading"])', { timeout: 15000 });
}

/** Waits until the app shell (not a gate) is shown. */
async function waitForApp(page) {
  await page.waitForSelector('[data-shell="app"]', { timeout: 15000 });
}

/** Marks the age gate and onboarding as done in IndexedDB, reloads, and waits for the app shell. */
async function passGates(page, baseUrl) {
  await ensureLoaded(page, baseUrl);
  await page.evaluate(async () => {
    const m = await import('/src/storage/idbRepo.ts');
    const repo = await m.openIdbRepo();
    const now = Date.now();
    await repo.updateSettings({ ageConfirmedAt: now, onboardedAt: now });
  });
  await page.reload();
  await waitForApp(page);
}

/** Imports both bundled demos (サンプルA, サンプルB) into IndexedDB, reloads and waits for the shell. */
async function seedDemos(page, baseUrl) {
  await ensureLoaded(page, baseUrl);
  const ids = await page.evaluate(async () => {
    const [{ openIdbRepo }, { importBundledDemos }] = await Promise.all([
      import('/src/storage/idbRepo.ts'),
      import('/src/app/library.ts'),
    ]);
    const repo = await openIdbRepo();
    return importBundledDemos(repo);
  });
  await page.reload();
  await page.waitForSelector('[data-shell]:not([data-shell="loading"])', { timeout: 15000 });
  return ids;
}

/** Deletes the IndexedDB databases 'shiori' and 'shiori-studio', then reloads (the age gate shows again). */
async function resetDb(page, baseUrl) {
  await ensureLoaded(page, baseUrl);
  await page.evaluate(async () => {
    const [player, studio] = await Promise.all([import('/src/storage/idbRepo.ts'), import('/src/storage/studioRepo.ts')]);
    await player.deleteIdbDatabase('shiori');
    await studio.deleteIdbStudioDatabase('shiori-studio');
  });
  await page.reload();
  await page.waitForSelector('[data-shell]:not([data-shell="loading"])', { timeout: 15000 });
}

/** Applies a settings patch (e.g. { discreet: {...} }, { pin }) and reloads. */
async function patchSettings(page, baseUrl, patch) {
  await ensureLoaded(page, baseUrl);
  await page.evaluate(async (p) => {
    const m = await import('/src/storage/idbRepo.ts');
    const repo = await m.openIdbRepo();
    await repo.updateSettings(p);
  }, patch);
  await page.reload();
  await page.waitForSelector('[data-shell]:not([data-shell="loading"])', { timeout: 15000 });
}

/** Full-page screenshot into `file` (directories are created). */
async function shot(page, file, opts = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  return file;
}

/** Fails loudly when the page scrolls horizontally (F18 AC3). Returns { scrollWidth, clientWidth }. */
async function checkNoHorizontalScroll(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

module.exports = {
  CHROMIUM,
  launch,
  passGates,
  seedDemos,
  resetDb,
  patchSettings,
  waitForApp,
  shot,
  checkNoHorizontalScroll,
};
