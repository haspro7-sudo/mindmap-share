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

  // ---------------------------------------------------------------- QA fix round 1

  await step('R6: reloading the demo URL (?seed=demo, no reset) continues the night', async () => {
    const demo = '?view=dual&script=1&seed=demo&test=1&seedNights=2'
    const { page, errors, context } = await openApp('dual', `${demo}&reset=1`, { fresh: false })
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(600)
    await page.evaluate(() => {
      const s = window.__navi.get()
      const c = s.deck.cards.find(x => x.kind === 'song' && x.songId)
      if (c) s.act(c.id, 'reserve')
      window.__navi.api.getState().placeOrder('water')
    })
    await page.waitForTimeout(700) // write-behind (300 ms)
    const snap = () =>
      page.evaluate(() => {
        const s = window.__navi.get()
        const mine = [...(s.room.now ? [s.room.now.item] : []), ...s.room.queue].filter(q => q.by === 'me').map(q => q.songId)
        return { nightId: s.session.nightId, visit: s.session.visit, mine, orders: s.orders.list.length, nights: s.col.nights.length }
      })
    const before = await snap()
    assert.ok(before.mine.length >= 1 && before.orders === 1, `set-up: ${JSON.stringify(before)}`)
    for (let i = 0; i < 3; i++) {
      await page.goto(new URL(demo, page.url()).href)
      await page.waitForSelector('[data-testid=app-root]')
      assert.equal(await attr(page, 'data-intro'), 'short', `reload ${i + 1}: short intro`)
      const after = await snap()
      assert.equal(after.nightId, before.nightId, `reload ${i + 1}: same night`)
      assert.equal(after.visit, before.visit, `reload ${i + 1}: visit unchanged`)
      assert.equal(after.nights, before.nights, `reload ${i + 1}: no orphan nights`)
      assert.equal(after.orders, 1, `reload ${i + 1}: orders kept`)
      assert.deepEqual(after.mine, before.mine, `reload ${i + 1}: my reservation kept (queue or NOW)`)
      await page.waitForTimeout(400)
    }
    noErrors(errors, 'reload')
    await context.close()
  })

  await step('a drifted snapshot (no orders, queue=null, broken collection) never blanks the app', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&reset=1&intro=0')
    await page.waitForSelector('[data-testid=app-root]')
    await page.evaluate(() => window.__navi.api.getState().placeOrder('water'))
    await page.waitForTimeout(700)
    await page.evaluate(() => {
      const k = 'shin-navi:v1:night'
      const v = JSON.parse(localStorage.getItem(k))
      delete v.data.orders
      v.data.room.queue = null
      localStorage.setItem(k, JSON.stringify(v))
      localStorage.setItem('shin-navi:v1:collection', JSON.stringify({ v: 1, data: { faces: [], nights: 'x', pins: 5 } }))
    })
    await page.goto(new URL('?test=1&intro=0', page.url()).href)
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(1200)
    assert.equal(await page.locator('[data-testid=app-error]').count(), 0, 'no error panel')
    assert.ok(await page.locator('[data-testid=deck]').count(), 'deck rendered')
    assert.equal(await attr(page, 'data-phase'), 'live')
    noErrors(errors, 'corrupt')
    // a render-time crash shows the calm reset panel, and its button brings the app back
    await page.evaluate(() => {
      const s = window.__navi.get()
      window.__navi.api.setState({ room: { ...s.room, members: null, queue: null } })
    })
    await page.waitForSelector('[data-testid=app-error]')
    await page.click('[data-testid=app-error-reset]')
    await page.waitForSelector('[data-testid=app-root]')
    await context.close()
  })

  await step('script mode: → / PageDown advance from a focused card and from the search field (capture phase)', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0&script=1')
    await page.waitForSelector('[data-testid=card-top]')
    await page.waitForTimeout(500)
    const sig = () =>
      page.evaluate(() => {
        const s = window.__navi.get()
        return JSON.stringify([s.room.queue.map(q => q.by + q.songId), Object.values(s.room.members).map(m => m.present), s.room.now?.item.id ?? null, s.room.sung.length])
      })
    const topId = () => page.evaluate(() => window.__navi.get().deck.cards[0]?.id)
    const top0 = await topId()
    await page.focus('[data-testid=card-top] .deck__drag')
    const s0 = await sig()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(600)
    const s1 = await sig()
    assert.notEqual(s1, s0, '→ on a focused card ran the next scripted event')
    // the first → is Jun's arrival (QA DEMO#1), which re-deals the hand, so the top card may
    // change by design: what must not happen is that → acted on the focused card (kept it)
    const acted = await page.evaluate(id => window.__navi.get().deck.history.filter(h => h.cardId === id).map(h => h.action), top0)
    assert.deepEqual(acted, [], 'the focused card was not acted on (kept) by →')
    await page.click('[data-testid=search-bar]')
    const input = page.locator('[data-testid=search-input]').first()
    await input.waitFor({ state: 'visible' })
    await input.fill('abc')
    await page.keyboard.press('PageDown')
    await page.waitForTimeout(600)
    assert.notEqual(await sig(), s1, 'PageDown in the search input ran the next event')
    assert.equal(await input.inputValue(), 'abc', 'the typed text is untouched')
    noErrors(errors, 'script keys')
    await context.close()
  })

  await step('script mode: the night’s first song starts by itself after the undo grace', async () => {
    const { page, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0&script=1')
    await page.waitForSelector('[data-testid=card-top]')
    await page.evaluate(() => {
      const s = window.__navi.get()
      const c = s.deck.cards.find(x => x.kind === 'song' && x.songId)
      s.act(c.id, 'reserve')
    })
    await page.waitForFunction(() => !!window.__navi.get().room.now, null, { timeout: 7000 })
    assert.ok(await page.evaluate(() => window.__navi.get().room.now.item.by === 'me'), 'my opener is on stage')
    await context.close()
  })

  await step('退室 unlinks the room screen: no [data-by=me], no present "me" orb, status says so', async () => {
    const { page, errors, context } = await openApp('dual', '?test=1&seed=demo&script=1&reset=1&intro=0&view=dual')
    await page.waitForSelector('[data-shell=room]')
    await page.waitForTimeout(800)
    await page.evaluate(() => {
      const s = window.__navi.get()
      const c = s.deck.cards.find(x => x.kind === 'song' && x.songId)
      if (c) s.act(c.id, 'reserve')
      window.__navi.fire({ t: 'myTurn' })
    })
    await page.waitForTimeout(600)
    await page.evaluate(() => {
      window.__navi.api.getState().reserve('marigold', { by: 'me', source: 'search' })
      window.__navi.api.getState().placeOrder('water')
    })
    await page.waitForTimeout(400)
    assert.ok(await page.locator('[data-shell=room] [data-by=me]').count(), 'set-up: the room shows my songs while live')
    await page.evaluate(() => window.__navi.fire({ t: 'exit' }))
    await page.waitForTimeout(1500)
    const check = async where => {
      const r = await page.evaluate(() => ({
        byMe: document.querySelectorAll('[data-shell=room] [data-by=me]').length,
        orb: document.querySelectorAll('[data-shell=room] [data-testid=member-orb][data-member=me][data-present="1"]').length,
        queueMine: window.__navi.get().room.queue.filter(q => q.by === 'me' || q.with === 'me').length,
        mePresent: window.__navi.get().room.members.me.present,
        unlinked: document.querySelector('[data-shell=room]')?.getAttribute('data-unlinked'),
      }))
      assert.deepEqual(r, { byMe: 0, orb: 0, queueMine: 0, mePresent: false, unlinked: '1' }, `${where}: ${JSON.stringify(r)}`)
    }
    await check('wrap')
    await page.evaluate(() => window.__navi.api.getState().closeNight({ linked: false }))
    await page.waitForTimeout(800)
    await check('closed')
    assert.equal(await page.getAttribute('[data-shell=phone] .ps-lane', 'data-unlinked'), '1', 'phone lane hidden on the bye screen')
    noErrors(errors, 'exit')
    await context.close()
  })

  await step('brand label is never cut at 360 (all locales)', async () => {
    for (const loc of ['ja', 'en', 'zhHant', 'zhHans', 'ko']) {
      const { page, context } = await openApp('small', `?test=1&seed=test&reset=1&intro=0&locale=${loc}`)
      await page.waitForSelector('[data-testid=brand-label]')
      await page.waitForTimeout(300)
      const m = await page.evaluate(() => {
        const t = document.querySelector('[data-testid=brand-label] .status__brandtext')
        return { sw: t.scrollWidth, cw: t.clientWidth, sh: t.scrollHeight, ch: t.clientHeight }
      })
      assert.ok(m.sw <= m.cw && m.sh <= m.ch + 1, `${loc}: brand fits ${JSON.stringify(m)}`)
      await context.close()
    }
  })

  await step('dual below 1366×768 scales uniformly (1024×768, 1280×720), no reflow, no scroll', async () => {
    const { page, errors, context } = await openApp('dual', '?test=1&seed=test&reset=1&intro=0&view=dual&locale=en')
    await page.waitForSelector('[data-shell=room]')
    assert.equal(await page.getAttribute('.dual-fit', 'data-fit'), '1.000')
    for (const vp of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(vp)
      await page.waitForTimeout(400)
      const fit = Number(await page.getAttribute('.dual-fit', 'data-fit'))
      const want = Math.min(vp.width / 1366, vp.height / 768)
      assert.ok(Math.abs(fit - want) < 0.002, `${vp.width}: fit ${fit} ≈ ${want}`)
      const box = await page.locator('[data-shell=dual]').boundingBox()
      assert.ok(Math.abs(box.width - 1366 * fit) < 2 && Math.abs(box.height - 768 * fit) < 2, `${vp.width}: stage keeps its proportions ${JSON.stringify(box)}`)
      const sw = await page.evaluate(() => document.documentElement.scrollWidth)
      assert.ok(sw <= vp.width, `${vp.width}: no horizontal scroll`)
    }
    noErrors(errors, 'dual fit')
    await context.close()
  })

  await step('a phone turned sideways (844×390) keeps the phone view and asks to turn back', async () => {
    const { page, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector('[data-testid=app-root]')
    await page.setViewportSize({ width: 844, height: 390 })
    await page.waitForTimeout(400)
    assert.equal(await attr(page, 'data-view'), 'phone')
    assert.ok(await page.locator('[data-testid=rotate-hint]').isVisible(), 'rotate hint')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(300)
    assert.equal(await page.locator('[data-testid=rotate-hint]').count(), 0)
    await context.close()
  })

  await step('intro: the dock waits for the lane (hidden at 1.0 s, in by 3.0 s)', async () => {
    const { page, context } = await openApp('phone', '?test=1&seed=test&reset=1', { fresh: false })
    await page.addInitScript(() => {
      const log = (window.__dockProbe = { t0: null, at1000: null, at3000: null })
      const tick = () => {
        const root = document.querySelector('[data-testid=app-root]')
        const now = performance.now()
        if (root && log.t0 == null) log.t0 = now
        const dock = document.querySelector('.dock')
        if (log.t0 != null && dock) {
          const t = now - log.t0
          const o = Number(getComputedStyle(dock).opacity)
          if (t >= 1000 && log.at1000 == null) log.at1000 = o
          if (t >= 3000 && log.at3000 == null) log.at3000 = o
        }
        if (log.at3000 == null) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.reload()
    await page.waitForFunction(() => window.__dockProbe && window.__dockProbe.at3000 != null, null, { timeout: 8000 })
    const r = await page.evaluate(() => window.__dockProbe)
    assert.ok(r.at1000 < 0.1, `dock hidden at 1.0 s (${r.at1000})`)
    assert.ok(r.at3000 > 0.95, `dock shown by 3.0 s (${r.at3000})`)
    await context.close()
  })

  await step('Korean wraps at word boundaries (html[lang=ko] → keep-all)', async () => {
    const { page, context } = await openApp('small', '?test=1&seed=test&reset=1&intro=0&locale=ko')
    await page.waitForSelector('[data-testid=app-root]')
    const r = await page.evaluate(() => [document.documentElement.lang, getComputedStyle(document.body).wordBreak])
    assert.deepEqual(r, ['ko', 'keep-all'])
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
