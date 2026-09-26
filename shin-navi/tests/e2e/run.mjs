// E2E runner (SPEC K-12 / M-0). Serves dist/ (or $DIST_DIR) and runs every specs/*.spec.mjs.
//   node tests/e2e/run.mjs            → all specs
//   node tests/e2e/run.mjs core stage → only specs whose file name starts with one of these
// A spec module exports `name` and `async run(ctx)`, where ctx is
//   { browser, url, assert, step, openApp(kind = 'phone', query = DEFAULT_QUERY, opts), VIEWPORTS, DEFAULT_QUERY }
// openApp returns { context, page, errors } (errors = console errors + page errors); close the
// context when done. A spec fails when run() throws; step(label, fn) reports sub-checks.
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { serveDist, launch, openApp as harnessOpen, VIEWPORTS } from './harness.mjs'

const DEFAULT_QUERY = '?test=1&seed=test&reset=1'
const SPEC_TIMEOUT = Number(process.env.SPEC_TIMEOUT || 180_000)
const filters = process.argv.slice(2)
const dir = new URL('./specs/', import.meta.url)
const files = (await readdir(dir)).filter(f => f.endsWith('.spec.mjs') && (!filters.length || filters.some(p => f.startsWith(p)))).sort()

if (!files.length) {
  console.error('no specs matched', filters)
  process.exit(1)
}

const server = await serveDist()
const browser = await launch()
const results = []
const t0 = Date.now()

try {
  for (const f of files) {
    const mod = await import(new URL(f, dir).href)
    const name = mod.name || f.replace('.spec.mjs', '')
    const steps = []
    const contexts = new Set()
    const ctx = {
      browser,
      url: server.url,
      assert,
      VIEWPORTS,
      DEFAULT_QUERY,
      async openApp(kind = 'phone', query = DEFAULT_QUERY, opts = {}) {
        const r = await harnessOpen(browser, new URL(query, server.url).href, kind, opts)
        contexts.add(r.context)
        return r
      },
      async step(label, fn) {
        const s = Date.now()
        try {
          await fn()
          steps.push({ label, ok: true, ms: Date.now() - s })
        } catch (err) {
          steps.push({ label, ok: false, ms: Date.now() - s, err })
          throw err
        }
      },
    }
    const started = Date.now()
    let error = null
    try {
      await Promise.race([mod.run(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${SPEC_TIMEOUT}ms`)), SPEC_TIMEOUT))])
    } catch (err) {
      error = err
    } finally {
      for (const c of contexts) await c.close().catch(() => {})
    }
    const ms = Date.now() - started
    results.push({ name, ok: !error, ms })
    console.log(`${error ? '✗' : '✓'} ${name}  (${(ms / 1000).toFixed(1)}s)`)
    for (const s of steps) console.log(`    ${s.ok ? '·' : '✗'} ${s.label}${s.ok ? '' : ''}`)
    if (error) console.log(`    ${String(error && error.stack ? error.stack : error).split('\n').slice(0, 6).join('\n    ')}`)
  }
} finally {
  await browser.close()
  await server.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} specs passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
process.exit(failed.length ? 1 : 0)
