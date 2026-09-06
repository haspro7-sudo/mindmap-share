// dist/ の index.html に JS/CSS をインライン化して dist-single/index.html を作る（Artifact / 単体配布用）
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = join(dist, 'assets');
for (const f of readdirSync(assets)) {
  const content = readFileSync(join(assets, f), 'utf8');
  if (f.endsWith('.js')) {
    html = html.replace(new RegExp(`<script[^>]*src="[^"]*${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*></script>`), () => `<script type="module">${content.replace(/<\/script/g, '<\\/script')}</script>`);
  } else if (f.endsWith('.css')) {
    html = html.replace(new RegExp(`<link[^>]*href="[^"]*${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`), () => `<style>${content}</style>`);
  }
}
mkdirSync('dist-single', { recursive: true });
writeFileSync('dist-single/index.html', html);
console.log(`wrote dist-single/index.html (${(html.length / 1024).toFixed(0)} KB)`);

// Artifact 用：<title>/<style>/<body の中身> だけを取り出した断片（doctype/html/head/body は配信側が付ける）
const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '';
const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
const body = (/<body>([\s\S]*?)<\/body>/.exec(html)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const scripts = [...html.matchAll(/<script type="module">[\s\S]*?<\/script>/g)].map((m) => m[0]).join('\n');
const fragment = `<title>${title}</title>\n<style>${style}</style>\n${body}\n${scripts}`;
writeFileSync('dist-single/artifact.html', fragment);
console.log(`wrote dist-single/artifact.html (${(fragment.length / 1024).toFixed(0)} KB)`);
