// Shared Playwright helpers: serve dist/ over localhost (secure context for mic APIs)
// and open the app in phone / tablet viewports while collecting console errors.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// DIST_DIR (optional) overrides the directory that is served; default is the repo's dist/.
const ROOT = process.env.DIST_DIR ? resolve(process.env.DIST_DIR) : fileURLToPath(new URL('../../dist/', import.meta.url))
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }

export async function serveDist() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent((req.url || '/').split('?')[0]))
    const file = join(ROOT, path === '/' ? 'index.html' : path)
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise(r => server.close(r)) }
}

export const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  small: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: true },
  dual: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
}

export async function launch() {
  const executablePath = process.env.PW_CHROMIUM || undefined
  return chromium.launch({
    executablePath,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  })
}

export async function openApp(browser, url, kind = 'phone', { fresh = true, locale = 'ja-JP' } = {}) {
  const context = await browser.newContext({ ...VIEWPORTS[kind], locale, permissions: ['microphone'] })
  const page = await context.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  await page.goto(url)
  if (fresh) {
    await page.evaluate(() => { try { localStorage.clear() } catch {} })
    await page.reload()
  }
  return { context, page, errors }
}
