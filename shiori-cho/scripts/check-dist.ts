/**
 * Post-build privacy/safety gate (docs/SPEC.md §7.2, F2 AC6):
 *  1. dist/ must not reference any http(s) host outside the allowlist (no third-party requests, no CDNs).
 *  2. src/ must not use dangerouslySetInnerHTML / innerHTML / outerHTML / insertAdjacentHTML / document.write.
 * Run after `npm run build`: `npm run check:dist`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const DIST = join(ROOT, 'dist')
const SRC = join(ROOT, 'src')

/** Hosts that may appear as strings. None of them is fetched at runtime (CSP connect-src 'self'). */
const ALLOWED_HOSTS = new Set([
  'www.dlsite.com', // store link builder (opened only by a user tap after a confirm dialog)
  'www.w3.org', // SVG/XML namespace identifiers
  'react.dev', // React's production error-decoder message text
  'localhost', // demo project appUrl default (creator kit only)
  'example.invalid', // placeholder URLs in help/kit text
])

/** Hosts allowed only in specific files: library strings that are never requested. */
const ALLOWED_IN_FILE: ReadonlyArray<{ file: RegExp; host: string }> = [
  { file: /^dist\/assets\/index-[\w-]+\.js$/, host: 'json-schema.org' }, // zod toJSONSchema `$schema` identifiers
  { file: /^dist\/workbox-[\w-]+\.js$/, host: 'bit.ly' }, // workbox console.warn help link
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const problems: string[] = []

try {
  statSync(DIST)
} catch {
  console.error('dist/ not found — run `npm run build` first')
  process.exit(1)
}

const TEXT_EXT = /\.(js|mjs|css|html|json|webmanifest|txt|svg)$/
const URL_RE = /https?:\/\/([a-zA-Z0-9.-]+)/g
for (const file of walk(DIST).filter((f) => TEXT_EXT.test(f))) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(URL_RE)) {
    const host = m[1]!.toLowerCase()
    const rel = relative(ROOT, file)
    if (ALLOWED_HOSTS.has(host) || ALLOWED_IN_FILE.some((a) => a.host === host && a.file.test(rel))) continue
    problems.push(`${rel}: unexpected host "${host}"`)
  }
}

const BANNED_SRC = [/dangerouslySetInnerHTML/, /\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/]
// Test files may read innerHTML in assertions; only application code is checked.
for (const file of walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes('/test/'))) {
  const text = readFileSync(file, 'utf8')
  for (const re of BANNED_SRC) {
    if (re.test(text)) problems.push(`${relative(ROOT, file)}: banned API ${re}`)
  }
}

if (problems.length) {
  console.error(`check-dist failed (${problems.length}):\n` + [...new Set(problems)].join('\n'))
  process.exit(1)
}
console.log('check-dist: OK (no third-party hosts in dist, no raw-HTML APIs in src)')
