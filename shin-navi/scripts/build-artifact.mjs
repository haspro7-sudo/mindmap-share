// Turn dist/index.html into a page body for a claude.ai Artifact.
// The Artifact host wraps the file in its own doctype/head/body and pads :root by the safe-area
// insets, so we drop our wrapper tags and zero our own top inset to avoid doubling it.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../dist/index.html', import.meta.url))
const out = fileURLToPath(new URL('../dist/artifact.html', import.meta.url))
const html = await readFile(src, 'utf8')

const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
const scripts = head.match(/<script[\s\S]*?<\/script>/g) ?? []
const styles = head.match(/<style[\s\S]*?<\/style>/g) ?? []

const page = [
  '<title>新ナビ ミラーボール</title>',
  '<meta name="theme-color" content="#07030f">',
  ...styles,
  // After the app styles so it wins: the host already pads :root by env(safe-area-inset-*).
  '<style>:root{--sat:0px}html,body{height:100%;background:#0b0620}</style>',
  body.trim(),
  ...scripts,
].join('\n')

await writeFile(out, page)
console.log(`artifact page: ${out} (${(page.length / 1024).toFixed(0)} KB, ${scripts.length} script, ${styles.length} style)`)
