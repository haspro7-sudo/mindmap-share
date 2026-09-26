// Screenshot the built app in each viewport. Usage: node tests/e2e/shoot.mjs [outDir] [waitMs]
import { mkdir } from 'node:fs/promises'
import { serveDist, launch, openApp, VIEWPORTS } from './harness.mjs'

const outDir = process.argv[2] || 'screenshots'
const waitMs = Number(process.argv[3] || 2500)
await mkdir(outDir, { recursive: true })

const server = await serveDist()
const browser = await launch()
let failed = false
try {
  for (const kind of Object.keys(VIEWPORTS)) {
    const { context, page, errors } = await openApp(browser, server.url, kind)
    await page.waitForTimeout(waitMs)
    await page.screenshot({ path: `${outDir}/${kind}.png` })
    console.log(`${kind}: ${errors.length ? errors.join('\n  ') : 'no errors'}`)
    if (errors.length) failed = true
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}
process.exit(failed ? 1 : 0)
