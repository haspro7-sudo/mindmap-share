// dist-single/index.html を Chromium で開いてスクリーンショットを撮る
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const out = process.argv[2] ?? 'screenshots';
import { mkdirSync } from 'node:fs';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(resolve('dist-single/index.html')).href);
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/01-title.png` });
await page.keyboard.press('ArrowDown'); // NORMAL → HARD? cursor starts at 1 (NORMAL)
await page.keyboard.press('ArrowUp');
await page.keyboard.press('Enter'); // NORMAL
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/02-intro.png` });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/03-select.png` });
// play a few beats
const keys = ['KeyE', 'KeyA', 'KeyS', 'KeyD', 'KeyA', 'KeyE', 'KeyA', 'KeyQ', 'KeyS', 'KeyA', 'KeyD', 'KeyA'];
let shot = 4;
for (const k of keys) {
  await page.keyboard.press(k);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-beat.png` });
  await page.waitForTimeout(2400);
}
await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-after.png` });
console.log('errors:', errors);
await browser.close();
