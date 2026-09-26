// M0 core acceptance (SPEC L/M0 6–7, T01 layout parts, T12 view selection).
export const name = 'core'

export async function run({ openApp, assert, step }) {
  const noErrors = (errors, where) => assert.deepEqual(errors, [], `${where}: console/page errors\n${errors.join('\n')}`)
  const attr = (page, a) => page.getAttribute('[data-testid=app-root]', a)

  for (const kind of ['phone', 'small', 'tablet']) {
    await step(`${kind}: app-root renders without errors`, async () => {
      const { page, errors, context } = await openApp(kind)
      await page.waitForSelector('[data-testid=app-root]')
      await page.waitForTimeout(1500)
      noErrors(errors, kind)
      await context.close()
    })
  }

  await step('dual: app-root renders without errors (?view=dual)', async () => {
    const { page, errors, context } = await openApp('dual', '?test=1&seed=test&reset=1&view=dual')
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(1500)
    noErrors(errors, 'dual')
    assert.equal(await attr(page, 'data-view'), 'dual')
    assert.ok(await page.locator('[data-testid=room-board]').count(), 'room screen visible in dual')
    assert.ok(await page.locator('[data-testid=deck]').count(), 'phone deck visible in dual')
    const sw = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(sw <= 1366, `dual has no horizontal scroll (scrollWidth ${sw})`)
    await context.close()
  })

  await step('small 360×740: no horizontal scroll', async () => {
    const { page, context } = await openApp('small')
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(800)
    const sw = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
    assert.ok(sw <= 360, `scrollWidth ${sw} > 360`)
    await context.close()
  })

  await step('view mode: phone at 390, room at 1280×800 and 1024×768', async () => {
    const a = await openApp('phone')
    await a.page.waitForSelector('[data-testid=app-root]')
    assert.equal(await attr(a.page, 'data-view'), 'phone')
    assert.equal(await attr(a.page, 'data-phase'), 'live')
    assert.match((await attr(a.page, 'data-intro')) ?? '', /^(full|short|none)$/)
    await a.context.close()
    const b = await openApp('tablet')
    await b.page.waitForSelector('[data-testid=app-root]')
    assert.equal(await attr(b.page, 'data-view'), 'room')
    const lane = await b.page.locator('[data-testid=stage-lane]').first().boundingBox()
    assert.ok(lane && lane.x < 1280 * 0.3, 'room lane sits in the left column')
    await b.page.setViewportSize({ width: 1024, height: 768 })
    await b.page.waitForTimeout(300)
    assert.equal(await attr(b.page, 'data-view'), 'room')
    // ResizeObserver switches to phone when the root gets narrow (no reload, no media query)
    await b.page.setViewportSize({ width: 600, height: 800 })
    await b.page.waitForTimeout(300)
    assert.equal(await attr(b.page, 'data-view'), 'phone')
    await b.context.close()
  })

  await step('lang sheet starts below the lane; the lane stays hittable', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector('[data-testid=lang-button]')
    await page.waitForTimeout(400)
    await page.click('[data-testid=lang-button]')
    const sheet = page.locator('[data-testid=sheet][data-sheet=lang]')
    await sheet.waitFor({ state: 'visible' })
    await page.waitForTimeout(700) // let the spring settle
    const lane = await page.locator('[data-testid=stage-lane]').first().boundingBox()
    assert.ok(lane, 'lane present')
    const box = await sheet.boundingBox()
    assert.ok(box.y >= lane.y + lane.height - 1, `sheet top ${box.y} starts below lane bottom ${lane.y + lane.height}`)
    const hit = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y)
      return !!el && !!el.closest('[data-testid=stage-lane], [data-stub=StageLane]')
    }, [lane.x + lane.width / 2, lane.y + lane.height / 2])
    assert.ok(hit, 'elementFromPoint at the lane centre is inside the lane')
    // choosing a chip switches the language in place
    await page.evaluate(() => (window.__marker = 1))
    await page.click('[data-testid=lang-chip][data-locale=ko]')
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ko')
    assert.equal(await page.evaluate(() => window.__marker), 1, 'no reload')
    assert.equal((await page.textContent('[data-testid=dock-discover]')).trim(), '찾기')
    noErrors(errors, 'lang flow')
    await context.close()
  })

  await step('?test=1 exposes window.__navi', async () => {
    const { page, context } = await openApp('phone')
    await page.waitForSelector('[data-testid=app-root]')
    const ok = await page.evaluate(() => {
      const n = window.__navi
      return !!n && typeof n.get === 'function' && !!n.api && typeof n.fire === 'function' && Array.isArray(n.soundLog) && typeof n.get().session.nightId === 'string'
    })
    assert.ok(ok, 'window.__navi { get, api, fire, soundLog }')
    await context.close()
  })

  await step('first tap turns the lights on (audio unlocked, lightOn logged)', async () => {
    const { page, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector('[data-testid=hero]')
    await page.mouse.click(40, 300)
    await page.waitForTimeout(150)
    const r = await page.evaluate(() => ({ on: window.__navi.get().session.audioOn, log: [...window.__navi.soundLog] }))
    assert.ok(r.on, 'session.audioOn after first tap')
    assert.ok(r.log.includes('lightOn'), `soundLog has lightOn: ${r.log}`)
    await context.close()
  })

  await step('keyboard + brand triple-tap wiring (L lens, S split, ? presenter)', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector('[data-testid=brand-label]')
    await page.keyboard.press('l')
    await page.waitForSelector('[data-testid=lens-overlay]')
    await page.keyboard.press('l')
    await page.keyboard.press('s')
    await page.waitForSelector('[data-testid=split-dynamic]')
    await page.keyboard.press('s')
    await page.keyboard.press('?')
    await page.waitForSelector('[data-testid=presenter-panel]')
    await page.keyboard.press('?')
    await page.waitForSelector('[data-testid=presenter-panel]', { state: 'detached' })
    const brand = page.locator('[data-testid=brand-label]')
    assert.match(await brand.textContent(), /新ナビ（コンセプト試作）/)
    await brand.click()
    await brand.click()
    await brand.click()
    await page.waitForSelector('[data-testid=presenter-panel]')
    noErrors(errors, 'keyboard')
    await context.close()
  })

  await step('dock tabs crossfade; the hero stays mounted; the lane stays', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector('[data-testid=dock-record]')
    const before = await page.locator('[data-testid=hero]').boundingBox()
    await page.click('[data-testid=dock-record]')
    await page.waitForSelector('[data-testid=record-screen]')
    assert.equal(await page.evaluate(() => window.__navi.get().ui.tab), 'record')
    assert.ok(await page.locator('[data-testid=stage-lane]').first().isVisible(), 'compact lane stays on record')
    await page.click('[data-testid=dock-discover]')
    await page.waitForTimeout(300)
    const after = await page.locator('[data-testid=hero]').boundingBox()
    assert.deepEqual(after, before, 'hero did not move')
    noErrors(errors, 'tabs')
    await context.close()
  })

  await step('prefers-reduced-motion → data-reduced=1', async () => {
    const { page, context } = await openApp('phone', '?test=1&seed=test&reset=1')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.reload()
    await page.waitForSelector('[data-testid=app-root][data-reduced="1"]')
    await context.close()
  })
}
