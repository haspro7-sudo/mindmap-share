/**
 * Third-party license notices (docs/SPEC.md §6 このアプリについて):
 *   node_modules/<pkg>/LICENSE of every package whose code ships in dist/ → public/licenses.txt
 *
 * The app bundles minified copies of these packages, and MIT/ISC/Apache-2.0 require their copyright and
 * permission notices to travel with them. The generated file is committed, copied to dist/ by Vite as a
 * same-origin static file, and linked from ヘルプ → このアプリについて.
 *
 * Run `npx tsx scripts/gen-licenses.ts` after adding or upgrading a runtime dependency and commit the output.
 * `--check` exits 1 when the committed file is stale (CI). `scripts/gen-licenses.test.ts` checks the same.
 *
 * URLs in the license texts lose their `http(s)://` prefix: check:dist fails on any unknown http(s) host in
 * dist/, and a license file is text to read, never a request the app makes.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const OUT_FILE = join(ROOT, 'public', 'licenses.txt');

interface ShippedRoot {
  name: string;
  /** also list the package's own `dependencies` (transitively): they are bundled with it */
  followDeps: boolean;
}

/**
 * Packages whose code is in the build output. Their runtime `dependencies` are followed (react-dom →
 * scheduler, workbox-window → workbox-core, workbox-precaching → workbox-routing/strategies); build tools
 * are listed without their dependencies, because only a small runtime helper of theirs is emitted.
 */
export const SHIPPED_ROOTS: readonly ShippedRoot[] = [
  { name: 'react', followDeps: true },
  { name: 'react-dom', followDeps: true },
  { name: 'zod', followDeps: true },
  { name: 'idb', followDeps: true },
  { name: 'fflate', followDeps: true },
  { name: 'qrcode-generator', followDeps: true },
  // index.js: the update prompt (virtual:pwa-register/react → workbox-window)
  { name: 'workbox-window', followDeps: true },
  // workbox-*.js next to sw.js (generateSW: precacheAndRoute, NavigationRoute, cleanupOutdatedCaches)
  { name: 'workbox-precaching', followDeps: true },
  { name: 'workbox-routing', followDeps: true },
  // sw.js itself is generated from workbox-build's service-worker template
  { name: 'workbox-build', followDeps: false },
  // the register hook of virtual:pwa-register/react
  { name: 'vite-plugin-pwa', followDeps: false },
  // the module-preload polyfill and the lazy-chunk preload helper in index.js
  { name: 'vite', followDeps: false },
  // the module loader at the top of sw.js (workbox-build bundles the service worker with it)
  { name: '@trickfilm400/rollup-plugin-off-main-thread', followDeps: false },
];

/** What each package does in the app (shown in the file's contents list). */
const USED_FOR: Readonly<Record<string, string>> = {
  react: '画面の表示',
  'react-dom': '画面の表示',
  scheduler: '画面の表示（React DOM の内部）',
  zod: 'しおりファイルとバックアップの検証',
  idb: '端末内への保存（IndexedDB）',
  fflate: '配布キット（zip）の作成',
  'qrcode-generator': 'QRコードの表示',
  'workbox-window': 'アプリの更新の確認',
  'workbox-core': 'オフライン対応（Service Worker）',
  'workbox-precaching': 'オフライン対応（Service Worker）',
  'workbox-routing': 'オフライン対応（Service Worker）',
  'workbox-strategies': 'オフライン対応（Service Worker）',
  'workbox-build': 'オフライン対応（Service Worker の生成）',
  'vite-plugin-pwa': 'Service Worker の登録',
  vite: 'スクリプトの読み込み',
  '@trickfilm400/rollup-plugin-off-main-thread': 'Service Worker のスクリプトの読み込み',
};

export interface PackageNotice {
  name: string;
  version: string;
  license: string;
  usedFor: string;
  /** copyright and license text, as shipped by the package (URLs without their scheme) */
  text: string;
}

interface PackageJson {
  name?: string;
  version?: string;
  license?: string;
  dependencies?: Record<string, string>;
}

const LICENSE_FILE = /^(licen[cs]e|copying)(?:[-.][\w.-]*)?$/i;

const MIT_PERMISSION = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

function readJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
}

/** Node-style lookup: <from>/node_modules/<name>, then each parent directory up to the project root. */
function findPackageDir(name: string, from: string, root: string): string {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (dir === root || parent === dir) break;
    dir = parent;
  }
  throw new Error(`${name} was not found in node_modules (run npm ci first)`);
}

function readLicenseFile(pkgDir: string, name: string): string {
  const file = readdirSync(pkgDir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort()[0];
  if (!file) throw new Error(`${name}: no LICENSE file (add an extractor in scripts/gen-licenses.ts)`);
  return readFileSync(join(pkgDir, file), 'utf8');
}

function requireText(text: string, name: string, ...needles: string[]): string {
  for (const n of needles) {
    if (!text.includes(n)) throw new Error(`${name}: expected "${n}" in its license text (the package changed?)`);
  }
  return text;
}

/** Packages that ship no plain LICENSE file, or one with more than their own notice in it. */
const EXTRACTORS: Readonly<Record<string, (pkgDir: string, name: string) => string>> = {
  // No LICENSE file: the notice is the header comment of the bundled source; the MIT text is the standard one.
  'qrcode-generator': (pkgDir, name) => {
    const header: string[] = [];
    for (const line of readFileSync(join(pkgDir, 'dist', 'qrcode.js'), 'utf8').split(/\r?\n/)) {
      if (!line.startsWith('//')) break;
      const text = line.replace(/^\/\/\s?/, '').trim();
      if (text !== '' && !/^-+$/.test(text)) header.push(text);
    }
    return requireText(`${header.join('\n')}\n\n${MIT_PERMISSION}`, name, 'Copyright', 'MIT license');
  },
  // LICENSE.md also lists everything bundled into Vite itself; only Vite's own code reaches the app.
  vite: (pkgDir, name) => {
    const full = readLicenseFile(pkgDir, name);
    const end = full.indexOf('# Licenses of bundled dependencies');
    if (end < 0) throw new Error(`${name}: LICENSE.md layout changed`);
    return requireText(full.slice(0, end), name, 'Copyright', 'Permission is hereby granted');
  },
  // The shipped loader's own header names its copyright holder; the package LICENSE is the Apache-2.0 text.
  '@trickfilm400/rollup-plugin-off-main-thread': (pkgDir, name) => {
    const loader = readFileSync(join(pkgDir, 'loader.ejs'), 'utf8');
    const copyright = /Copyright[^\n]*/.exec(loader)?.[0].trim();
    if (!copyright) throw new Error(`${name}: loader.ejs has no copyright line`);
    return requireText(`${copyright}\n\n${readLicenseFile(pkgDir, name)}`, name, 'Apache License');
  },
};

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\bhttps?:\/\//g, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Every package whose code is bundled into dist/, sorted by name (deterministic output). */
export function collectNotices(root: string = ROOT): PackageNotice[] {
  const byKey = new Map<string, PackageNotice>();
  const visit = (name: string, from: string, followDeps: boolean, parent?: string): void => {
    const dir = findPackageDir(name, from, root);
    const pkg = readJson(join(dir, 'package.json'));
    const version = pkg.version ?? '0.0.0';
    const key = `${name}@${version}`;
    if (byKey.has(key)) return;
    const extract = EXTRACTORS[name];
    const text = normalize(extract ? extract(dir, name) : readLicenseFile(dir, name));
    byKey.set(key, {
      name,
      version,
      license: pkg.license ?? 'SEE LICENSE',
      usedFor: USED_FOR[name] ?? `${parent ?? name} の内部`,
      text,
    });
    if (!followDeps) return;
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (dep.startsWith('@types/')) continue; // type declarations only, nothing is bundled
      visit(dep, dir, true, name);
    }
  };
  for (const r of SHIPPED_ROOTS) visit(r.name, root, r.followDeps);
  return [...byKey.values()].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name < b.name ? -1 : 1));
}

const RULE = '='.repeat(72);

/**
 * The public/licenses.txt text. It starts with a UTF-8 BOM so browsers decode the Japanese header correctly
 * even when a static server sends text/plain without a charset (Vite's dev and preview servers do).
 */
export function renderNotices(notices: readonly PackageNotice[]): string {
  const lines: string[] = [
    '﻿しおり帳（Shiori Companion）で利用しているオープンソースソフトウェア',
    'Third-party software notices',
    '',
    'しおり帳には、以下のオープンソースソフトウェアが含まれています。',
    'それぞれの著作権表示とライセンスの全文を掲載します（文中の URL は、先頭の「http(s)://」を省いています）。',
    '',
    '一覧',
    ...notices.map((n) => `- ${n.name} ${n.version}（${n.license}）… ${n.usedFor}`),
    '',
  ];
  for (const n of notices) {
    lines.push(RULE, `${n.name} ${n.version}`, `License: ${n.license}`, RULE, '', n.text, '');
  }
  lines.push('（このファイルは scripts/gen-licenses.ts で生成しています）', '');
  const out = lines.join('\n');
  const url = /https?:\/\/[^\s]*/.exec(out);
  if (url) throw new Error(`licenses.txt would contain a URL (${url[0]}); check:dist rejects unknown hosts`);
  return out;
}

function main(argv: readonly string[]): number {
  const text = renderNotices(collectNotices());
  if (argv.includes('--check')) {
    const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : '';
    if (current !== text) {
      console.error('public/licenses.txt is out of date: run `npx tsx scripts/gen-licenses.ts` and commit it');
      return 1;
    }
    console.log('gen-licenses: public/licenses.txt is up to date');
    return 0;
  }
  writeFileSync(OUT_FILE, text);
  console.log(`gen-licenses: wrote public/licenses.txt (${text.length} chars)`);
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = main(process.argv.slice(2));
}
