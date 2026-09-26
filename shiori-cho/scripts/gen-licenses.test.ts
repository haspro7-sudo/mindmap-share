// public/licenses.txt: the third-party notices linked from ヘルプ → このアプリについて (docs/SPEC.md §6).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectNotices, OUT_FILE, renderNotices, ROOT } from './gen-licenses';

const notices = collectNotices();
const names = notices.map((n) => n.name);

describe('gen-licenses (third-party notices)', () => {
  it('covers every runtime dependency and the runtime code of the build tools', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    for (const dep of Object.keys(pkg.dependencies)) expect(names).toContain(dep);
    // bundled through a dependency or emitted by the build
    for (const n of ['scheduler', 'workbox-window', 'workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies', 'vite-plugin-pwa'])
      expect(names).toContain(n);
    expect(names.some((n) => n.startsWith('@types/'))).toBe(false);
  });

  it('carries a copyright line and the license terms for every package', () => {
    for (const n of notices) {
      expect(n.text, n.name).toMatch(/Copyright/);
      expect(n.text, n.name).toMatch(/Permission is hereby granted|Permission to use, copy, modify|Apache License/);
    }
    // qrcode-generator ships no LICENSE file: its header notice plus the MIT terms stand in for it
    const qr = notices.find((n) => n.name === 'qrcode-generator')!;
    expect(qr.text).toContain('Copyright (c) 2009 Kazuhiko Arase');
    expect(qr.text).toContain('Permission is hereby granted');
    // Vite's LICENSE.md lists its own bundled tools too; only Vite's notice belongs here
    expect(notices.find((n) => n.name === 'vite')!.text).not.toContain('Licenses of bundled dependencies');
  });

  it('has no http(s) URL, so check:dist keeps passing with the file in dist/', () => {
    expect(renderNotices(notices)).not.toMatch(/https?:\/\//);
  });

  it('matches the committed public/licenses.txt (run `npx tsx scripts/gen-licenses.ts` after a dependency change)', () => {
    expect(readFileSync(OUT_FILE, 'utf8')).toBe(renderNotices(notices));
  });
});
